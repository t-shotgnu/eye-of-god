from __future__ import annotations

import asyncio
import difflib
from datetime import datetime
from urllib.parse import quote

import httpx

from prick.config import Settings
from prick.models import Changes, DiffLine, FileChange, Finding, PullRequest

MAX_FILE_BYTES = 400_000
MAX_FILES = 500
MAX_TEXT_FILES = 100


class ExternalError(Exception):
    """An external service failed; messages must not include credentials or response bodies."""


def map_pull_request(raw: dict, settings: Settings) -> PullRequest:
    pr_id = raw["pullRequestId"]
    root = f"https://dev.azure.com/{quote(settings.organization, safe='')}/{quote(settings.project, safe='')}"
    return PullRequest(
        id=pr_id,
        title=raw["title"],
        description=raw.get("description") or "",
        author=raw.get("createdBy", {}).get("displayName", "Unknown author"),
        created=raw["creationDate"],
        source_branch=raw["sourceRefName"].removeprefix("refs/heads/"),
        target_branch=raw["targetRefName"].removeprefix("refs/heads/"),
        status=raw["status"],
        draft=raw.get("isDraft", False),
        source_commit=raw.get("lastMergeSourceCommit", {}).get("commitId", ""),
        target_commit=raw.get("lastMergeTargetCommit", {}).get("commitId", ""),
        url=f"{root}/_git/{quote(settings.repository, safe='')}/pullrequest/{pr_id}",
    )


def make_diff(old: str, new: str) -> tuple[list[DiffLine], int, int]:
    before, after = old.splitlines(), new.splitlines()
    # Bound pathological SequenceMatcher inputs; callers skip excessively long files.
    matcher = difflib.SequenceMatcher(None, before, after, autojunk=True)
    lines: list[DiffLine] = []
    additions = deletions = 0
    for group in matcher.get_grouped_opcodes(3):
        first, last = group[0], group[-1]
        lines.append(
            DiffLine(
                kind="hunk",
                text=f"@@ -{first[1] + 1},{last[2] - first[1]} +{first[3] + 1},{last[4] - first[3]} @@",
            )
        )
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                lines.extend(
                    DiffLine(kind="context", text=before[i], old=i + 1, new=j1 + i - i1 + 1)
                    for i in range(i1, i2)
                )
            if tag in {"delete", "replace"}:
                lines.extend(
                    DiffLine(kind="delete", text=before[i], old=i + 1) for i in range(i1, i2)
                )
                deletions += i2 - i1
            if tag in {"insert", "replace"}:
                lines.extend(DiffLine(kind="add", text=after[j], new=j + 1) for j in range(j1, j2))
                additions += j2 - j1
    return lines, additions, deletions


def thread_payload(finding: Finding, change: FileChange, changes: Changes, content: str) -> dict:
    return {
        "comments": [{"parentCommentId": 0, "content": content, "commentType": 1}],
        "status": 1,
        "threadContext": {
            "filePath": change.path,
            f"{finding.side}FileStart": {"line": finding.line_start, "offset": 1},
            f"{finding.side}FileEnd": {"line": finding.line_end, "offset": 1},
        },
        "pullRequestThreadContext": {
            "changeTrackingId": change.tracking_id,
            # Equal iteration IDs refer to the common ancestor, per the official API.
            "iterationContext": {
                "firstComparingIteration": changes.iteration,
                "secondComparingIteration": changes.iteration,
            },
        },
    }


class AzureDevOps:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        settings.require_azure()
        self.settings = settings
        self.client = client
        self.auth = httpx.BasicAuth("", settings.azure_pat.get_secret_value())
        self.base = (
            f"https://dev.azure.com/{quote(settings.organization, safe='')}/"
            f"{quote(settings.project, safe='')}/_apis/git/repositories/"
            f"{quote(settings.repository, safe='')}"
        )

    async def request(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        params = {"api-version": "7.1", **kwargs.pop("params", {})}
        try:
            response = await self.client.request(
                method, self.base + path, params=params, auth=self.auth, **kwargs
            )
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            hint = (
                "Check PAT permissions and connection settings."
                if status in {401, 403, 404}
                else "Try again later."
            )
            raise ExternalError(f"Azure DevOps returned HTTP {status}. {hint}") from None
        except httpx.RequestError:
            raise ExternalError(
                "Could not reach Azure DevOps. Check the connection and try again."
            ) from None

    async def list_prs(self) -> list[PullRequest]:
        results: list[PullRequest] = []
        skip = 0
        while True:
            raw = (
                await self.request(
                    "GET",
                    "/pullrequests",
                    params={"searchCriteria.status": "active", "$top": 100, "$skip": skip},
                )
            ).json()
            page = raw.get("value", [])
            results.extend(map_pull_request(item, self.settings) for item in page)
            if len(page) < 100:
                break
            skip += len(page)
            if skip >= 1000:
                raise ExternalError("More than 1,000 active PRs. Select a smaller repository.")
        return sorted(results, key=lambda pr: pr.created, reverse=True)

    async def get_pr(self, pr_id: int) -> PullRequest:
        raw = (await self.request("GET", f"/pullrequests/{pr_id}")).json()
        return map_pull_request(raw, self.settings)

    async def file_text(self, path: str, commit: str) -> tuple[str, str | None]:
        params = {
            "api-version": "7.1",
            "path": path,
            "versionDescriptor.version": commit,
            "versionDescriptor.versionType": "commit",
            "download": "true",
        }
        try:
            async with self.client.stream(
                "GET",
                self.base + "/items",
                params=params,
                auth=self.auth,
                headers={"Accept": "application/octet-stream"},
            ) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_FILE_BYTES:
                        return "", "File exceeds 400 KB; excluded from analysis."
            if b"\x00" in data:
                return "", "Binary file; excluded from analysis."
            try:
                value = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                return "", "Non-UTF-8 file; excluded from analysis."
            if len(value.splitlines()) > 8000:
                return "", "File exceeds 8,000 lines; excluded from analysis."
            return value, None
        except httpx.HTTPStatusError as exc:
            raise ExternalError(
                f"Azure DevOps could not retrieve a changed file (HTTP {exc.response.status_code})."
            ) from None
        except httpx.RequestError:
            raise ExternalError("Azure DevOps file retrieval failed. Try again.") from None

    async def changes(self, pr: PullRequest) -> Changes:
        prefix = f"/pullrequests/{pr.id}"
        iterations = (await self.request("GET", prefix + "/iterations")).json().get("value", [])
        if not iterations:
            raise ExternalError(
                "This PR has no reviewable iterations. Iteration-enabled Azure Repos PRs are required."
            )
        latest = max(iterations, key=lambda item: item["id"])
        pr.updated = (
            datetime.fromisoformat(latest["updatedDate"].replace("Z", "+00:00"))
            if latest.get("updatedDate")
            else None
        )
        source = latest["sourceRefCommit"]["commitId"]
        target = latest["targetRefCommit"]["commitId"]
        base = latest.get("commonRefCommit", {}).get("commitId")
        if not base:
            raise ExternalError("Azure DevOps did not provide a common ancestor for this PR.")
        entries: list[dict] = []
        skip = 0
        while True:
            result = (
                await self.request(
                    "GET",
                    f"{prefix}/iterations/{latest['id']}/changes",
                    params={"$compareTo": 0, "$top": 100, "$skip": skip},
                )
            ).json()
            entries.extend(result.get("changeEntries", []))
            if len(entries) > MAX_FILES:
                raise ExternalError("This PR exceeds 500 changed files. Split it before reviewing.")
            next_skip = result.get("nextSkip", 0)
            if not next_skip:
                break
            if next_skip <= skip:
                raise ExternalError("Azure DevOps returned invalid pagination for PR changes.")
            skip = next_skip
        semaphore = asyncio.Semaphore(6)

        async def read_change(index: int, entry: dict) -> FileChange:
            item = entry["item"]
            change = FileChange(
                path=item["path"],
                old_path=entry.get("originalPath") or item["path"],
                change_type=entry["changeType"],
                tracking_id=entry["changeTrackingId"],
            )
            if item.get("isFolder"):
                change.skipped_reason = "Directory entry."
                return change
            if index >= MAX_TEXT_FILES:
                change.skipped_reason = "Only the first 100 files are read; excluded from analysis."
                return change
            async with semaphore:
                kinds = {part.strip().lower() for part in change.change_type.split(",")}
                old, old_reason = (
                    ("", None) if "add" in kinds else await self.file_text(change.old_path, base)
                )
                new, new_reason = (
                    ("", None) if "delete" in kinds else await self.file_text(change.path, source)
                )
                change.skipped_reason = old_reason or new_reason
                if not change.skipped_reason:
                    change.lines, change.additions, change.deletions = await asyncio.to_thread(
                        make_diff, old, new
                    )
                return change

        files = await asyncio.gather(*(read_change(i, entry) for i, entry in enumerate(entries)))
        return Changes(
            pr_id=pr.id,
            iteration=latest["id"],
            source_commit=source,
            target_commit=target,
            base_commit=base,
            files=files,
        )

    async def publish(self, pr_id: int, payload: dict) -> int:
        raw = (await self.request("POST", f"/pullrequests/{pr_id}/threads", json=payload)).json()
        return int(raw["id"])
