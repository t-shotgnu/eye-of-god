import inspect
import json
from types import SimpleNamespace

import httpx
import pytest

from prick.azure import ExternalError
from prick.config import Settings
from prick.models import Summary
from prick.providers import CopilotProvider, OpenAICompatibleProvider

RESULT = {"classification": "TESTS", "size": "small", "risk": "low", "description": "Adds tests."}


@pytest.mark.parametrize(
    "mode,expected", [("schema", "json_schema"), ("json", "json_object"), ("prompt", None)]
)
async def test_compatible_provider_real_http_payload_and_parsing(mode, expected):
    def handler(request):
        assert request.url == "http://localhost:11434/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["model"] == "local-model" and payload["max_tokens"] == 400
        assert payload.get("response_format", {}).get("type") == expected
        assert "max_completion_tokens" not in payload
        assert "Authorization" not in request.headers
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(RESULT)}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAICompatibleProvider(
            Settings(
                provider="compatible",
                model="local-model",
                api_base="http://localhost:11434/v1",
                structured_mode=mode,
            ),
            client,
        )
        assert (
            await provider.generate_structured("Classify", "Code", Summary)
        ).classification == "TESTS"


async def test_openai_uses_official_endpoint_and_handles_refusal():
    def handler(request):
        assert request.url.host == "api.openai.com"
        assert request.headers["Authorization"] == "Bearer api-secret"
        assert json.loads(request.content)["response_format"]["json_schema"]["strict"]
        return httpx.Response(200, json={"choices": [{"message": {"refusal": "No thanks"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAICompatibleProvider(
            Settings(model="account-model", api_key="api-secret"), client
        )
        with pytest.raises(ExternalError, match="declined"):
            await provider.generate_structured("Classify", "Code", Summary)


async def test_provider_http_error_does_not_expose_credentials_or_body():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(429, text="api-secret"))
    ) as client:
        with pytest.raises(ExternalError) as exc:
            await OpenAICompatibleProvider(
                Settings(model="account-model", api_key="api-secret"), client
            ).generate_structured("x", "y", Summary)
        assert "429" in str(exc.value) and "api-secret" not in str(exc.value)


async def test_copilot_matches_installed_official_sdk_signatures_and_disables_tools(monkeypatch):
    copilot = pytest.importorskip("copilot")
    from copilot.session import CopilotSession

    create_signature = inspect.signature(copilot.CopilotClient.create_session)
    send_signature = inspect.signature(CopilotSession.send_and_wait)
    constructed = []

    class Session:
        async def send_and_wait(self, *args, **kwargs):
            send_signature.bind(self, *args, **kwargs)
            return SimpleNamespace(data=SimpleNamespace(content=json.dumps(RESULT)))

        async def destroy(self):
            constructed.append("destroyed")

    class Client:
        def __init__(self, config):
            assert isinstance(config, copilot.SubprocessConfig)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def create_session(self, **kwargs):
            create_signature.bind(self, **kwargs)
            assert kwargs["available_tools"] == [] and kwargs["enable_config_discovery"] is False
            assert kwargs["on_permission_request"](None, {}).kind == "reject"
            return Session()

    monkeypatch.setattr(copilot, "CopilotClient", Client)
    result = await CopilotProvider(Settings(provider="copilot")).generate_structured(
        "Classify", "Code", Summary
    )
    assert result.risk == "low" and constructed == ["destroyed"]
