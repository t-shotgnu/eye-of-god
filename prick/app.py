from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import Field, ValidationError

from prick.azure import AzureDevOps, ExternalError, thread_payload
from prick.config import (
    ENV_FIELDS,
    SECRET_ENV,
    Settings,
    data_directory,
    load_settings,
    save_settings,
)
from prick.demo import DemoAzure
from prick.models import Model, Review, ReviewOptions, Summary
from prick.prompts import SUMMARY_INSTRUCTIONS, limited_changes, review_data
from prick.providers import create_provider
from prick.review import finding_error, generate_review, same_revision
from prick.store import Store

ROOT = Path(__file__).parent
templates = Jinja2Templates(directory=ROOT / "templates")
logger = logging.getLogger(__name__)


class FindingEdit(Model):
    comment: str = Field(min_length=1, max_length=12000)
    decision: Literal["draft", "approved", "ignored"]


def publication_digest(review: Review, finding_id: str | None = None) -> str:
    approved = [
        f
        for f in review.findings
        if f.decision == "approved"
        and f.publish_state == "unpublished"
        and (finding_id is None or f.id == finding_id)
    ]
    value = json.dumps(
        {
            "review": review.id,
            "scope": review.scope,
            "comments": [f.model_dump() for f in approved],
        },
        sort_keys=True,
    )
    return hashlib.sha256(value.encode()).hexdigest()


def create_app(directory: Path | None = None) -> FastAPI:
    directory = directory or data_directory()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = load_settings(directory)
        app.state.store = Store(directory)
        app.state.csrf = secrets.token_urlsafe(32)
        app.state.lock = asyncio.Lock()
        app.state.summary_lock = asyncio.Lock()
        async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
            app.state.client = client
            yield

    app = FastAPI(title="Eye of God", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

    @app.middleware("http")
    async def local_security(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Host validation also protects local instances from DNS rebinding.
        import os

        allowed = {"localhost", "127.0.0.1", "::1", "testserver"}
        allowed.update(
            host.strip()
            for host in os.environ.get("PRICK_ALLOWED_HOSTS", "").split(",")
            if host.strip()
        )
        if request.url.hostname not in allowed:
            return HTMLResponse(
                "Host is not allowed. Configure PRICK_ALLOWED_HOSTS for this hostname.",
                status_code=400,
            )
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
                return HTMLResponse("Cross-origin request rejected.", status_code=403)
            form = await request.form()
            token = str(form.get("csrf", ""))
            if not secrets.compare_digest(token, getattr(app.state, "csrf", "")) or not token:
                return HTMLResponse(
                    "The page has expired. Reload before submitting.", status_code=403
                )
            request.state.form = form
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
        )
        return response

    def render(request: Request, name: str, status: int = 200, **context: object) -> HTMLResponse:
        return templates.TemplateResponse(
            request=request,
            name=name,
            context={
                "settings": app.state.settings,
                "csrf": app.state.csrf,
                **context,
            },
            status_code=status,
        )

    def azure(settings: Settings | None = None) -> AzureDevOps | DemoAzure:
        settings = settings or app.state.settings
        return DemoAzure() if settings.demo else AzureDevOps(settings, app.state.client)

    def redirect_or_reviews(
        request: Request, pr_id: int, notice: str = "", error: str = ""
    ) -> Response:
        if request.headers.get("HX-Request"):
            reviews = app.state.store.reviews(app.state.settings.scope, pr_id)
            return render(
                request, "reviews.html", pr_id=pr_id, reviews=reviews, notice=notice, error=error
            )
        return RedirectResponse(f"/prs/{pr_id}", status_code=303)

    def get_review(pr_id: int, review_id: str) -> Review:
        review = app.state.store.review(review_id, app.state.settings.scope, pr_id)
        if review is None:
            raise HTTPException(404, "Review not found for this repository and PR")
        return review

    @app.exception_handler(ExternalError)
    @app.exception_handler(ValueError)
    async def external_error(request: Request, exc: Exception) -> HTMLResponse:
        # Pydantic error strings can contain sensitive inputs. Never return them.
        message = (
            "Invalid input. Check your settings and slider values."
            if isinstance(exc, ValidationError)
            else str(exc)
        )
        return render(request, "error.html", error=message)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> HTMLResponse:
        logger.error("Request failed (%s)", type(exc).__name__)
        return render(
            request,
            "error.html",
            error="An unexpected error occurred. Reload the page and check the server logs.",
            status=500,
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request) -> HTMLResponse:
        prs = await azure().list_prs()
        return render(request, "dashboard.html", prs=prs)

    @app.get("/prs/{pr_id}/summary", response_class=HTMLResponse)
    async def summary(request: Request, pr_id: int) -> HTMLResponse:
        settings = app.state.settings
        service = azure(settings)
        try:
            pr = await service.get_pr(pr_id)
            changes = await service.changes(pr)
            key = hashlib.sha256(
                json.dumps(
                    {
                        "scope": settings.scope,
                        "pr": pr.model_dump(mode="json"),
                        "revision": [
                            changes.source_commit,
                            changes.target_commit,
                            changes.base_commit,
                            changes.iteration,
                        ],
                        "provider": settings.provider,
                        "model": settings.model,
                        "base": settings.api_base,
                        "format": settings.structured_mode,
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            # Serializes inexpensive model calls to avoid a dashboard bursting provider limits.
            async with app.state.summary_lock:
                result = app.state.store.summary(key)
                if result is None:
                    sample, warnings = limited_changes(changes, 8000)
                    result = await create_provider(settings, app.state.client).generate_structured(
                        SUMMARY_INSTRUCTIONS, review_data(pr, sample), Summary
                    )
                    app.state.store.save_summary(key, result)
                else:
                    _, warnings = limited_changes(changes, 8000)
            return render(
                request,
                "summary.html",
                summary=result,
                changes=changes,
                partial=bool(warnings),
                updated=pr.updated,
            )
        except (ExternalError, ValueError) as exc:
            message = (
                "Invalid connection settings." if isinstance(exc, ValidationError) else str(exc)
            )
            return render(request, "summary.html", error=message, pr_id=pr_id)

    @app.get("/prs/{pr_id}", response_class=HTMLResponse)
    async def details(request: Request, pr_id: int) -> HTMLResponse:
        service = azure()
        pr = await service.get_pr(pr_id)
        changes = await service.changes(pr)
        prs = await service.list_prs()
        reviews = app.state.store.reviews(app.state.settings.scope, pr_id)
        return render(
            request, "details.html", pr=pr, prs=prs, changes=changes, reviews=reviews, pr_id=pr_id
        )

    @app.post("/prs/{pr_id}/review", response_class=HTMLResponse)
    async def review(request: Request, pr_id: int) -> Response:
        settings = app.state.settings
        form = request.state.form
        try:
            options = ReviewOptions.model_validate(
                {
                    name: form.get(name, 0 if name == "archaic_english" else None)
                    for name in ReviewOptions.model_fields
                }
            )
            service = azure(settings)
            pr = await service.get_pr(pr_id)
            changes = await service.changes(pr)
            result = await generate_review(
                pr, changes, options, settings, create_provider(settings, app.state.client)
            )
            app.state.store.save_review(result)
            return redirect_or_reviews(
                request,
                pr_id,
                notice="Review generated. Every finding is a draft until you approve it.",
            )
        except (ExternalError, ValueError) as exc:
            message = (
                "Review sliders must be integers from 1 to 10; Archaic English allows 0 to 10."
                if isinstance(exc, ValidationError)
                else str(exc)
            )
            return redirect_or_reviews(request, pr_id, error=message)

    @app.post("/prs/{pr_id}/reviews/{review_id}/findings/{finding_id}")
    async def edit_finding(
        request: Request, pr_id: int, review_id: str, finding_id: str
    ) -> Response:
        async with app.state.lock:
            result = get_review(pr_id, review_id)
            finding = next((f for f in result.findings if f.id == finding_id), None)
            if not finding:
                raise HTTPException(404, "Finding not found")
            if finding.publish_state != "unpublished":
                return redirect_or_reviews(
                    request,
                    pr_id,
                    error="This comment has already been posted or has an unresolved publishing outcome.",
                )
            value = FindingEdit.model_validate(
                {
                    "comment": request.state.form.get("comment", "").strip(),
                    "decision": request.state.form.get("decision"),
                }
            )
            finding.comment, finding.decision = value.comment, value.decision
            app.state.store.save_review(result)
            return redirect_or_reviews(request, pr_id, notice="Comment and decision saved.")

    @app.get("/prs/{pr_id}/reviews/{review_id}/publish", response_class=HTMLResponse)
    async def publish_preview(
        request: Request, pr_id: int, review_id: str, finding_id: str | None = None
    ) -> HTMLResponse:
        result = get_review(pr_id, review_id)
        approved = [
            f
            for f in result.findings
            if f.decision == "approved"
            and f.publish_state == "unpublished"
            and (finding_id is None or f.id == finding_id)
        ]
        return render(
            request,
            "publish.html",
            review=result,
            approved=approved,
            finding_id=finding_id,
            pr_id=pr_id,
            digest=publication_digest(result, finding_id),
        )

    @app.post("/prs/{pr_id}/reviews/{review_id}/publish", response_class=HTMLResponse)
    async def publish(request: Request, pr_id: int, review_id: str) -> Response:
        async with app.state.lock:
            settings = app.state.settings
            result = get_review(pr_id, review_id)
            only = request.state.form.get("finding_id") or None
            approved = [
                f
                for f in result.findings
                if f.decision == "approved"
                and f.publish_state == "unpublished"
                and (only is None or f.id == only)
            ]
            if request.state.form.get("confirm") != "publish" or not approved:
                return render(
                    request, "error.html", error="No approved unpublished comments were selected."
                )
            service = azure(settings)
            pr = await service.get_pr(pr_id)
            current = await service.changes(pr)
            if not secrets.compare_digest(
                str(request.state.form.get("digest", "")), publication_digest(result, only)
            ):
                return render(
                    request,
                    "error.html",
                    error="Approved comments changed since the preview. Open the publishing preview again before posting.",
                )
            if (
                pr.status != "active"
                or not same_revision(result.changes, current)
                or (pr.source_commit and pr.source_commit != current.source_commit)
                or (pr.target_commit and pr.target_commit != current.target_commit)
            ):
                return render(
                    request,
                    "error.html",
                    error="The PR changed or is no longer active. Generate and approve a new review before publishing.",
                )
            for item in approved:
                if finding_error(item.finding, result.changes) or finding_error(
                    item.finding, current
                ):
                    return render(
                        request,
                        "error.html",
                        error="A finding no longer refers to valid changed lines. Generate a new review.",
                    )
            posted = 0
            for item in approved:
                change = next(f for f in current.files if f.path == item.finding.file)
                payload = thread_payload(item.finding, change, current, item.comment)
                item.publish_state = "publishing"
                app.state.store.save_review(result)
                try:
                    item.thread_id = (
                        (10000 + posted) if settings.demo else await service.publish(pr_id, payload)
                    )
                    item.publish_state = "published"
                    posted += 1
                except Exception:
                    item.publish_state = "uncertain"
                    app.state.store.save_review(result)
                    return render(
                        request,
                        "error.html",
                        error=f"{posted} comment(s) posted. The next comment's outcome is uncertain. Check Azure DevOps before retrying; this comment is blocked from automatic re-posting.",
                    )
                app.state.store.save_review(result)
            return RedirectResponse(f"/prs/{pr_id}", status_code=303)

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page(request: Request) -> HTMLResponse:
        return render(request, "settings.html", env_fields=ENV_FIELDS | SECRET_ENV)

    @app.post("/settings", response_class=HTMLResponse)
    async def update_settings(request: Request) -> HTMLResponse:
        form = request.state.form
        current = app.state.settings
        values = current.model_dump()
        for name in [
            "organization",
            "project",
            "repository",
            "provider",
            "model",
            "api_base",
            "structured_mode",
            "repository_instructions",
        ]:
            values[name] = str(form.get(name, "")).strip()
        for name in ["demo", "profanity"]:
            values[name] = name in form
        for name in SECRET_ENV:
            if form.get(f"clear_{name}"):
                values[name] = ""
            elif form.get(name):
                values[name] = form[name]
        values["defaults"] = {
            name: form.get(
                name, current.defaults.archaic_english if name == "archaic_english" else None
            )
            for name in ReviewOptions.model_fields
        }
        try:
            new = Settings.model_validate(values)
            if not new.demo:
                new.require_azure()
            async with app.state.lock:
                save_settings(directory, new)
                app.state.settings = load_settings(directory)
            return render(
                request,
                "settings.html",
                env_fields=ENV_FIELDS | SECRET_ENV,
                notice="Settings saved. Environment variables take precedence.",
            )
        except ValueError as exc:
            error = (
                " / ".join(e["msg"] for e in exc.errors(include_input=False))
                if isinstance(exc, ValidationError)
                else str(exc)
            )
            return render(request, "settings.html", env_fields=ENV_FIELDS | SECRET_ENV, error=error)

    return app


app = create_app()
