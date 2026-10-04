import httpx

from prick.app import publication_digest
from prick.config import Settings, load_settings, save_settings
from prick.models import ReviewFinding
from prick.store import Store


def create_review(client, csrf):
    response = client.post(
        "/prs/142/review",
        data={"csrf": csrf, "thoroughness": 5, "nitpicking": 3, "conventions": 5, "tone": 5},
        headers={"HX-Request": "true"},
    )
    assert response.status_code == 200 and "draft" in response.text
    return client.app.state.store.reviews("demo", 142)[0]


def approve(client, csrf, review):
    item = review.findings[0]
    return client.post(
        f"/prs/142/reviews/{review.id}/findings/{item.id}",
        data={"csrf": csrf, "comment": "My edited review comment", "decision": "approved"},
        headers={"HX-Request": "true"},
    )


def test_generate_edit_approve_preview_publish_and_repeat_protection(client, csrf):
    review = create_review(client, csrf)
    assert all(f.publish_state == "unpublished" for f in review.findings)
    assert approve(client, csrf, review).status_code == 200
    path = f"/prs/142/reviews/{review.id}/publish"
    preview = client.get(path)
    assert "My edited review comment" in preview.text
    assert "Simulate publishing 1 approved" in preview.text
    approved = client.app.state.store.review(review.id, "demo", 142)
    response = client.post(
        path, data={"csrf": csrf, "confirm": "publish", "digest": publication_digest(approved)}
    )
    assert response.status_code == 200
    result = client.app.state.store.review(review.id, "demo", 142)
    assert result.findings[0].publish_state == "published"
    assert result.findings[0].comment == "My edited review comment"
    again = client.post(path, data={"csrf": csrf, "confirm": "publish"})
    assert "No approved unpublished comments" in again.text


def test_drafts_and_ignored_comments_cannot_publish(client, csrf):
    review = create_review(client, csrf)
    response = client.post(
        f"/prs/142/reviews/{review.id}/publish", data={"csrf": csrf, "confirm": "publish"}
    )
    assert "No approved unpublished comments" in response.text
    assert (
        client.app.state.store.review(review.id, "demo", 142).findings[0].publish_state
        == "unpublished"
    )


def test_stale_reviews_and_repository_scope_are_rejected(client, csrf):
    review = create_review(client, csrf)
    approve(client, csrf, review)
    saved = client.app.state.store.review(review.id, "demo", 142)
    saved.changes.source_commit = "obsolete"
    client.app.state.store.save_review(saved)
    response = client.post(
        f"/prs/142/reviews/{review.id}/publish",
        data={"csrf": csrf, "confirm": "publish", "digest": publication_digest(saved)},
    )
    assert "PR changed" in response.text
    wrong_pr = client.get(f"/prs/139/reviews/{review.id}/publish")
    assert wrong_pr.status_code == 404


def test_csrf_and_origin_checks(client, csrf):
    assert client.post("/prs/142/review", data={}).status_code == 403
    assert (
        client.post(
            "/prs/142/review", data={"csrf": csrf}, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert client.get("/", headers={"Host": "evil.test"}).status_code == 400


def test_credentials_are_never_rendered(client, tmp_path):
    client.app.state.settings = Settings(azure_pat="PAT-VALUE-SECRET", api_key="KEY-VALUE-SECRET")
    response = client.get("/settings")
    assert "PAT-VALUE-SECRET" not in response.text and "KEY-VALUE-SECRET" not in response.text
    save_settings(tmp_path, client.app.state.settings)
    assert load_settings(tmp_path).azure_pat.get_secret_value() == "PAT-VALUE-SECRET"


def test_interrupted_publication_is_persistently_blocked(client, csrf, tmp_path):
    review = create_review(client, csrf)
    review.findings[0].publish_state = "publishing"
    client.app.state.store.save_review(review)
    reopened = Store(client.app.state.store.path.parent)
    result = reopened.review(review.id, "demo", 142)
    assert result.findings[0].publish_state == "uncertain"


def test_preview_is_invalidated_when_approved_comment_changes(client, csrf):
    review = create_review(client, csrf)
    approve(client, csrf, review)
    saved = client.app.state.store.review(review.id, "demo", 142)
    digest = publication_digest(saved)
    saved.findings[0].comment = "Changed in another tab after preview"
    client.app.state.store.save_review(saved)
    response = client.post(
        f"/prs/142/reviews/{review.id}/publish",
        data={"csrf": csrf, "confirm": "publish", "digest": digest},
    )
    assert "changed since the preview" in response.text
    assert (
        client.app.state.store.review(review.id, "demo", 142).findings[0].publish_state
        == "unpublished"
    )


def test_env_secret_is_not_copied_to_settings_file(tmp_path, monkeypatch):
    monkeypatch.setenv("PRICK_API_KEY", "ENV-ONLY-SECRET")
    settings = load_settings(tmp_path)
    save_settings(tmp_path, settings)
    assert "ENV-ONLY-SECRET" not in (tmp_path / "settings.json").read_text()
    assert load_settings(tmp_path).api_key.get_secret_value() == "ENV-ONLY-SECRET"


def test_legacy_review_options_load_with_modern_english(client, csrf):
    from prick.models import Review

    result = create_review(client, csrf)
    old_json = result.model_dump()
    old_json["options"].pop("archaic_english")
    assert Review.model_validate(old_json).options.archaic_english == 0


def test_archaic_slider_value_is_accepted_by_the_review_route(client, csrf):
    response = client.post(
        "/prs/142/review",
        data={
            "csrf": csrf,
            "thoroughness": 5,
            "nitpicking": 3,
            "conventions": 5,
            "tone": 5,
            "archaic_english": 10,
        },
        headers={"HX-Request": "true"},
    )
    assert response.status_code == 200
    result = client.app.state.store.reviews("demo", 142)[0]
    assert result.options.archaic_english == 10 and "Behold" in result.findings[0].comment
    assert result.findings[0].finding.explanation.startswith("When remaining is zero")


def test_partial_remote_publish_preserves_success_and_blocks_uncertain_retry(client, csrf):
    review = create_review(client, csrf)
    settings = Settings(
        demo=False, organization="org", project="project", repository="repo", azure_pat="test-pat"
    )
    client.app.state.settings = settings
    review.scope = settings.scope
    review.changes.source_commit = "source"
    review.changes.target_commit = "target"
    review.changes.base_commit = "ancestor"
    review.findings[0].decision = "approved"
    review.findings.append(
        ReviewFinding(
            finding=review.findings[0].finding,
            comment="Another approved comment",
            decision="approved",
        )
    )
    client.app.state.store.save_review(review)
    posted = []

    def handler(request):
        path = request.url.path
        if path.endswith("/pullrequests/142"):
            return httpx.Response(
                200,
                json={
                    "pullRequestId": 142,
                    "title": "Retry",
                    "createdBy": {"displayName": "Ada"},
                    "creationDate": "2026-10-01T12:00:00Z",
                    "sourceRefName": "refs/heads/fix",
                    "targetRefName": "refs/heads/main",
                    "status": "active",
                    "lastMergeSourceCommit": {"commitId": "source"},
                    "lastMergeTargetCommit": {"commitId": "target"},
                },
            )
        if path.endswith("/iterations"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": 1,
                            "sourceRefCommit": {"commitId": "source"},
                            "targetRefCommit": {"commitId": "target"},
                            "commonRefCommit": {"commitId": "ancestor"},
                        }
                    ]
                },
            )
        if path.endswith("/changes"):
            return httpx.Response(
                200,
                json={
                    "changeEntries": [
                        {
                            "item": {"path": "/src/retry.py"},
                            "changeType": "edit",
                            "changeTrackingId": 1,
                        }
                    ]
                },
            )
        if path.endswith("/items"):
            content = (
                "def backoff(attempt):\n    return 2 ** attempt\n"
                if request.url.params["versionDescriptor.version"] == "ancestor"
                else "def backoff(attempt, remaining):\n    # Scale delay to the remaining retry budget.\n    delay = 2 ** attempt\n    return delay / remaining\n"
            )
            return httpx.Response(200, text=content)
        if path.endswith("/threads"):
            posted.append(request)
            if len(posted) == 1:
                return httpx.Response(200, json={"id": 777})
            raise httpx.ReadTimeout("Server may have accepted the second comment", request=request)
        raise AssertionError(str(request.url))

    client.app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    path = f"/prs/142/reviews/{review.id}/publish"
    response = client.post(
        path, data={"csrf": csrf, "confirm": "publish", "digest": publication_digest(review)}
    )
    assert "1 comment(s) posted" in response.text
    saved = client.app.state.store.review(review.id, settings.scope, 142)
    assert saved.findings[0].publish_state == "published" and saved.findings[0].thread_id == 777
    assert saved.findings[1].publish_state == "uncertain"
    client.post(
        path, data={"csrf": csrf, "confirm": "publish", "digest": publication_digest(saved)}
    )
    assert len(posted) == 2


def test_summary_cache_uses_a_short_classification_call_and_invalidates_model_changes(
    client, monkeypatch
):
    from prick.models import Summary

    calls = []

    class Provider:
        async def generate_structured(self, instructions, data, schema):
            calls.append(schema)
            return Summary(
                classification="SMALL BUGFIX",
                size="small",
                risk="medium",
                description="Retry changes.",
            )

    monkeypatch.setattr("prick.app.create_provider", lambda *args: Provider())
    for _ in range(2):
        assert "Retry changes." in client.get("/prs/142/summary").text
    assert calls == [Summary]
    client.app.state.settings.model = "another-model"
    client.get("/prs/142/summary")
    assert calls == [Summary, Summary]
