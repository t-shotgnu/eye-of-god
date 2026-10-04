import json

import httpx
import pytest

from prick.azure import AzureDevOps, ExternalError, map_pull_request, thread_payload
from prick.config import Settings
from prick.models import Finding

SETTINGS = Settings(
    demo=False, organization="org", project="Project name", repository="repo", azure_pat="secret"
)
RAW_PR = {
    "pullRequestId": 21,
    "title": "Fix issue",
    "description": "details",
    "createdBy": {"displayName": "Ada"},
    "creationDate": "2026-10-01T12:00:00Z",
    "sourceRefName": "refs/heads/fix/a",
    "targetRefName": "refs/heads/main",
    "status": "active",
    "lastMergeSourceCommit": {"commitId": "source"},
    "lastMergeTargetCommit": {"commitId": "target"},
    "isDraft": True,
}


def test_response_mapping():
    pr = map_pull_request(RAW_PR, SETTINGS)
    assert pr.id == 21 and pr.author == "Ada"
    assert pr.source_branch == "fix/a" and pr.target_branch == "main"
    assert pr.draft and pr.created.year == 2026
    assert "Project%20name" in pr.url


async def test_iterations_pagination_common_ancestor_rename_delete_and_thread_mapping():
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers["Authorization"].startswith("Basic ")
        path, params = request.url.path, request.url.params
        if path.endswith("/iterations"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": 2,
                            "sourceRefCommit": {"commitId": "source"},
                            "targetRefCommit": {"commitId": "target"},
                            "commonRefCommit": {"commitId": "ancestor"},
                            "updatedDate": "2026-10-02T15:00:00Z",
                        }
                    ]
                },
            )
        if path.endswith("/changes"):
            assert params["$compareTo"] == "0"
            if params["$skip"] == "0":
                return httpx.Response(
                    200,
                    json={
                        "changeEntries": [
                            {
                                "item": {"path": "/new.py"},
                                "originalPath": "/old.py",
                                "changeType": "rename, edit",
                                "changeTrackingId": 4,
                            }
                        ],
                        "nextSkip": 1,
                    },
                )
            return httpx.Response(
                200,
                json={
                    "changeEntries": [
                        {
                            "item": {"path": "/gone.py"},
                            "changeType": "delete",
                            "changeTrackingId": 5,
                        }
                    ],
                    "nextSkip": 0,
                },
            )
        if path.endswith("/items"):
            assert "$format" not in params
            assert params["download"] == "true"
            assert request.headers["Accept"] == "application/octet-stream"
            content = {
                ("/old.py", "ancestor"): "old\n",
                ("/new.py", "source"): "new\n",
                ("/gone.py", "ancestor"): "gone\n",
            }[(params["path"], params["versionDescriptor.version"])]
            assert params["versionDescriptor.versionType"] == "commit"
            return httpx.Response(200, text=content)
        if path.endswith("/threads"):
            payload = json.loads(request.content)
            assert payload["threadContext"]["leftFileStart"]["line"] == 1
            return httpx.Response(200, json={"id": 321})
        raise AssertionError(str(request.url))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        azure = AzureDevOps(SETTINGS, client)
        pr = map_pull_request(RAW_PR, SETTINGS)
        changes = await azure.changes(pr)
        assert pr.updated.day == 2 and len(changes.files) == 2
        assert changes.base_commit == "ancestor"
        assert changes.additions == 1 and changes.deletions == 2
        finding = Finding(
            file="/gone.py",
            side="left",
            line_start=1,
            line_end=1,
            severity="warning",
            category="bug",
            explanation="Deletion breaks a caller.",
            suggested_change=None,
        )
        payload = thread_payload(finding, changes.files[1], changes, "Edited comment")
        assert payload["pullRequestThreadContext"] == {
            "changeTrackingId": 5,
            "iterationContext": {"firstComparingIteration": 2, "secondComparingIteration": 2},
        }
        assert await azure.publish(pr.id, payload) == 321


async def test_http_errors_are_sanitized():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(401, text="secret server body"))
    ) as client:
        with pytest.raises(ExternalError) as error:
            await AzureDevOps(SETTINGS, client).list_prs()
    assert "401" in str(error.value) and "secret" not in str(error.value)


async def test_binary_and_large_files_are_explicitly_excluded():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"binary\x00"))
    ) as client:
        value, reason = await AzureDevOps(SETTINGS, client).file_text("/binary", "sha")
        assert not value and "Binary" in reason
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"a" * 400001))
    ) as client:
        _, reason = await AzureDevOps(SETTINGS, client).file_text("/large", "sha")
        assert "400 KB" in reason
