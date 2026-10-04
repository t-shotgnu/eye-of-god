import json

import httpx

from prick.models import ReviewOptions
from prick.sandbox import PR_ID, SCOPE, sample


def options(csrf, **overrides):
    return {"csrf": csrf, **ReviewOptions().model_dump(), **overrides}


def test_open_sandbox_is_inert_and_does_not_require_azure(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Opening sandbox must not contact Azure or AI")

    monkeypatch.setattr("prick.app.AzureDevOps", forbidden)
    monkeypatch.setattr("prick.app.create_provider", forbidden)
    client.app.state.settings.demo = False
    page = client.get("/sandbox")
    assert page.status_code == 200
    assert "/src/downloads.py" in page.text
    assert "/src/retry.py" in page.text
    assert "/tests/test_retry.py" in page.text
    assert 'action="/sandbox/review"' in page.text
    assert 'name="archaic_english"' in page.text
    assert "Sample context" in page.text
    assert "Simulated AI" not in page.text
    assert "hx-get=" not in page.text
    assert "Configure AI provider" in page.text


def test_sandbox_uses_real_provider_in_demo_mode_and_isolates_results(client, csrf, monkeypatch):
    calls = []
    settings = client.app.state.settings
    settings.provider = "compatible"
    settings.model = "test-model"
    settings.api_base = "http://local-model/v1"

    def forbidden(*args, **kwargs):
        raise AssertionError("Sandbox must never use Azure")

    monkeypatch.setattr("prick.app.AzureDevOps", forbidden)

    async def post(url, **kwargs):
        calls.append(kwargs["json"])
        assert url == "http://local-model/v1/chat/completions"
        payload = kwargs["json"]
        if payload["response_format"]["json_schema"]["name"] == "Analysis":
            data = json.loads(payload["messages"][1]["content"])
            assert data["pr"]["id"] == PR_ID
            result = {
                "overview": "Download paths lack containment.",
                "findings": [
                    {
                        "file": "/src/downloads.py",
                        "side": "right",
                        "line_start": 7,
                        "line_end": 7,
                        "severity": "must-fix",
                        "category": "security",
                        "explanation": "Untrusted paths can escape the download directory.",
                        "suggested_change": "Resolve the path and enforce containment before reading.",
                    }
                ],
            }
        else:
            data = json.loads(payload["messages"][1]["content"])
            assert data["presentation"] == {"tone": 9, "archaic_english": 8}
            result = {
                "comments": [
                    {
                        "index": 0,
                        "comment": "Thou shalt enforce path containment before reading untrusted paths.",
                    }
                ]
            }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(result)}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(client.app.state.client, "post", post)
    response = client.post(
        "/sandbox/review",
        data=options(csrf, thoroughness=8, nitpicking=10, conventions=7, tone=9, archaic_english=8),
        headers={"HX-Request": "true"},
    )
    assert response.status_code == 200
    assert "Thou shalt" in response.text
    assert "Publishing is disabled" in response.text
    assert len(calls) == 2
    assert calls[0]["model"] == "test-model"
    assert settings.demo is True
    review = client.app.state.store.reviews(SCOPE, PR_ID)[0]
    assert review.provider == "compatible"
    assert review.options == ReviewOptions(
        thoroughness=8, nitpicking=10, conventions=7, tone=9, archaic_english=8
    )
    assert review.findings[0].decision == "draft"
    assert review.findings[0].publish_state == "unpublished"
    assert not client.app.state.store.reviews("demo", PR_ID)
    assert "Publish approved" not in response.text
    assert "Approve comment" not in response.text
    assert "<form" not in response.text
    page = client.get("/sandbox")
    assert "Thou shalt" in page.text
    assert "Download paths lack containment" in page.text
    path = f"/prs/{PR_ID}/reviews/{review.id}"
    assert client.get(path + "/publish").status_code == 404
    assert (
        client.post(path + "/publish", data={"csrf": csrf, "confirm": "publish"}).status_code == 404
    )
    assert (
        client.post(
            path + f"/findings/{review.findings[0].id}",
            data={"csrf": csrf, "comment": "Approve", "decision": "approved"},
        ).status_code
        == 404
    )
    assert client.post("/sandbox/publish", data={"csrf": csrf}).status_code == 404


def test_sandbox_validation_and_configuration_errors(client, csrf):
    assert client.post("/sandbox/review", data=options("wrong")).status_code == 403
    invalid = client.post(
        "/sandbox/review", data=options(csrf, archaic_english=11), headers={"HX-Request": "true"}
    )
    assert "Archaic English allows 0 to 10" in invalid.text
    missing_model = client.post(
        "/sandbox/review", data=options(csrf), headers={"HX-Request": "true"}
    )
    assert "Set an AI model in Settings" in missing_model.text
    normal_form = client.post("/sandbox/review", data=options(csrf))
    assert "Set an AI model in Settings" in normal_form.text
    assert "Closed review workspace" in normal_form.text
    assert not client.app.state.store.reviews(SCOPE, PR_ID)


def test_sample_has_stable_revision_and_all_files_are_reviewable():
    pr, changes = sample()
    assert pr.source_commit == changes.source_commit
    assert pr.target_commit == changes.target_commit
    assert changes == sample()[1]
    assert len(changes.files) == 3
    assert all(file.additions and file.deletions for file in changes.files)
