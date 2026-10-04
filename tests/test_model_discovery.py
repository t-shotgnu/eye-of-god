import json

import httpx
import pytest

from prick.azure import ExternalError
from prick.config import Settings
from prick.demo import DemoAzure
from prick.models import Analysis, ReviewOptions, StyledComments
from prick.providers import OpenAICompatibleProvider
from prick.sandbox import SCOPE


async def test_openai_model_listing_authentication_and_sorting():
    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/models"
        assert request.method == "GET"
        assert request.headers["Authorization"] == "Bearer test-key"
        return httpx.Response(
            200, json={"data": [{"id": "model-b"}, {"id": "model-a"}, {"id": "model-a"}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await OpenAICompatibleProvider(
            Settings(api_key="test-key", api_base="http://ignore/v1"), client
        ).list_models()
    assert result == ["model-a", "model-b"]


@pytest.mark.parametrize("status", [401, 403, 429, 500])
async def test_model_list_errors_hide_provider_body_and_credentials(status):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(status, text="secret-key"))
    ) as client:
        with pytest.raises(ExternalError) as error:
            await OpenAICompatibleProvider(Settings(api_key="secret-key"), client).list_models()
    assert str(status) in str(error.value)
    assert "secret-key" not in str(error.value)


@pytest.mark.parametrize("body", [{}, {"data": {}}, {"data": [{"id": 2}]}, {"data": [{"id": ""}]}])
async def test_model_list_malformed_responses_are_readable(body):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    ) as client:
        with pytest.raises(ExternalError, match="invalid model list"):
            await OpenAICompatibleProvider(Settings(api_key="secret-key"), client).list_models()


async def test_model_list_timeout_and_missing_key():
    def handler(request):
        raise httpx.ReadTimeout("secret-key", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ExternalError, match="API key"):
            await OpenAICompatibleProvider(Settings(), client).list_models()
        with pytest.raises(ExternalError, match="timed out"):
            await OpenAICompatibleProvider(Settings(api_key="secret-key"), client).list_models()


def test_model_discovery_unsaved_key_cache_refresh_and_credential_isolation(
    client, csrf, monkeypatch
):
    calls = []

    async def get(url, **kwargs):
        key = kwargs["headers"]["Authorization"]
        calls.append((url, key))
        return httpx.Response(
            200,
            json={"data": [{"id": "model-" + str(len(calls))}]},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(client.app.state.client, "get", get)
    data = {"csrf": csrf, "provider": "openai", "api_key": "unsaved-key"}
    first = client.post("/settings/ai/models", data=data).json()
    assert first["models"] == ["model-1"]
    assert "unsaved-key" not in json.dumps(first)
    assert client.app.state.settings.api_key.get_secret_value() == ""
    assert not (client.app.state.store.path.parent / "settings.json").exists()
    assert client.post("/settings/ai/models", data=data).json()["checked_at"] == first["checked_at"]
    assert len(calls) == 1
    assert client.post("/settings/ai/models", data={**data, "refresh": "true"}).json()[
        "models"
    ] == ["model-2"]
    assert client.post("/settings/ai/models", data={**data, "api_key": "different-key"}).json()[
        "models"
    ] == ["model-3"]
    assert client.post(
        "/settings/ai/models",
        data={**data, "provider": "compatible", "api_base": "http://local/v1"},
    ).json()["models"] == ["model-4"]
    assert calls[-1][0] == "http://local/v1/models"
    assert client.post("/settings/ai/models", data={**data, "clear_api_key": "on"}).json()["error"]
    assert client.post("/settings/ai/models", data={"csrf": "wrong"}).status_code == 403
    assert (
        "Copilot"
        in client.post("/settings/ai/models", data={**data, "provider": "copilot"}).json()["error"]
    )


def test_model_catalog_expiry_and_failed_refresh_discard_stale_cache(client, csrf, monkeypatch):
    client.app.state.settings.api_key = Settings(api_key="saved-key").api_key
    responses = [200, 200, 401]

    async def get(url, **kwargs):
        status = responses.pop(0)
        return httpx.Response(
            status, json={"data": [{"id": "model-a"}]}, request=httpx.Request("GET", url)
        )

    monkeypatch.setattr(client.app.state.client, "get", get)
    client.post("/settings/ai/models", data={"csrf": csrf})
    key, cached = next(iter(client.app.state.model_catalog.items()))
    client.app.state.model_catalog[key] = (cached[0] - 301, cached[1], cached[2])
    assert client.post("/settings/ai/models", data={"csrf": csrf}).json()["models"] == ["model-a"]
    assert (
        "401"
        in client.post("/settings/ai/models", data={"csrf": csrf, "refresh": "true"}).json()[
            "error"
        ]
    )
    assert not client.app.state.model_catalog


def test_model_check_honors_environment_overrides(client, csrf, monkeypatch):
    monkeypatch.setenv("PRICK_PROVIDER", "openai")
    monkeypatch.setenv("PRICK_API_KEY", "env-key")
    client.app.state.settings = Settings(provider="openai", api_key="env-key")

    async def get(url, **kwargs):
        assert url == "https://api.openai.com/v1/models"
        assert kwargs["headers"]["Authorization"] == "Bearer env-key"
        return httpx.Response(200, json={"data": []}, request=httpx.Request("GET", url))

    monkeypatch.setattr(client.app.state.client, "get", get)
    result = client.post(
        "/settings/ai/models",
        data={
            "csrf": csrf,
            "provider": "compatible",
            "api_key": "ignore-key",
            "clear_api_key": "on",
        },
    ).json()
    assert result["provider"] == "openai" and result["models"] == []


@pytest.mark.parametrize("sandbox", [False, True])
@pytest.mark.parametrize("selection", ["selected-model", "__custom__", ""])
def test_review_model_choice_is_request_local_and_used_for_both_stages(
    client, csrf, monkeypatch, sandbox, selection
):
    calls = []
    current = client.app.state.settings
    current.model = "saved-default"
    current.demo = sandbox
    monkeypatch.setattr("prick.app.AzureDevOps", lambda settings, client: DemoAzure())

    class Provider:
        def __init__(self, model):
            self.model = model

        async def generate_structured(self, instructions, data, schema):
            calls.append(self.model)
            if schema is Analysis:
                raw = json.loads(data)
                file = "/src/downloads.py" if raw["pr"]["id"] == 1 else "/src/retry.py"
                line = 7 if sandbox else 4
                return Analysis.model_validate(
                    {
                        "overview": "A supported finding.",
                        "findings": [
                            {
                                "file": file,
                                "side": "right",
                                "line_start": line,
                                "line_end": line,
                                "severity": "warning",
                                "category": "bug",
                                "explanation": "The operation can fail.",
                                "suggested_change": "Guard the operation.",
                            }
                        ],
                    }
                )
            assert schema is StyledComments
            return StyledComments.model_validate(
                {"comments": [{"index": 0, "comment": "Please guard the operation."}]}
            )

    def provider(settings, client):
        calls.append(settings.model)
        assert settings is not current
        return Provider(settings.model)

    monkeypatch.setattr("prick.app.create_provider", provider)
    expected = "custom-model" if selection == "__custom__" else selection or "saved-default"
    data = {
        "csrf": csrf,
        **ReviewOptions(tone=2).model_dump(),
        "review_model": selection,
        "review_model_custom": "custom-model",
    }
    path = "/sandbox/review" if sandbox else "/prs/142/review"
    response = client.post(path, data=data, headers={"HX-Request": "true"})
    assert response.status_code == 200
    assert calls == [expected, expected, expected]
    result = client.app.state.store.reviews(
        SCOPE if sandbox else current.scope, 1 if sandbox else 142
    )[0]
    assert current.model == "saved-default"
    assert current.demo is sandbox
    assert result.model == expected
    assert "Please guard the operation" in result.findings[0].comment


def test_review_model_custom_empty_and_oversized_are_rejected(client, csrf):
    for selection, custom in [("__custom__", ""), ("x" * 201, "")]:
        response = client.post(
            "/sandbox/review",
            data={
                "csrf": csrf,
                **ReviewOptions().model_dump(),
                "review_model": selection,
                "review_model_custom": custom,
            },
            headers={"HX-Request": "true"},
        )
        assert "model ID" in response.text or "Model ID" in response.text
        assert not client.app.state.store.reviews(SCOPE, 1)
