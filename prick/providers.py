from __future__ import annotations

import asyncio
import json
from typing import Protocol, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from prick.azure import ExternalError
from prick.config import Settings

T = TypeVar("T", bound=BaseModel)


class AIProvider(Protocol):
    async def generate_structured(self, instructions: str, data: str, schema: type[T]) -> T: ...


def parse_response[T: BaseModel](content: str, schema: type[T]) -> T:
    if len(content) > 200_000:
        raise ExternalError("AI response was too large. No findings were accepted.")
    content = content.strip()
    if content.startswith("```json\n") and content.endswith("```"):
        content = content[8:-3].strip()
    elif content.startswith("```\n") and content.endswith("```"):
        content = content[4:-3].strip()
    try:
        return schema.model_validate_json(content, strict=True)
    except ValidationError:
        raise ExternalError(
            "AI returned invalid structured output. No findings were accepted; try another model or output mode."
        ) from None


def strict_schema(schema: type[BaseModel]) -> dict:
    result = schema.model_json_schema()

    def visit(node: object) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(result)
    return result


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def generate_structured(self, instructions: str, data: str, schema: type[T]) -> T:
        if not self.settings.model.strip():
            raise ExternalError("Set an AI model in Settings before generating a review.")
        if self.settings.provider == "openai" and not self.settings.api_key.get_secret_value():
            raise ExternalError("Set an API key in Settings or PRICK_API_KEY.")
        output_schema = strict_schema(schema)
        instructions += "\n\nReturn only JSON matching this schema:\n" + json.dumps(output_schema)
        payload: dict = {
            "model": self.settings.model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": data},
            ],
            "max_completion_tokens": 8000 if schema.__name__ != "Summary" else 400,
        }
        if self.settings.structured_mode == "schema":
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "strict": True, "schema": output_schema},
            }
        elif self.settings.structured_mode == "json":
            payload["response_format"] = {"type": "json_object"}
        # Some compatible servers only accept max_tokens. Keep this an explicit provider choice.
        if self.settings.provider == "compatible":
            payload["max_tokens"] = payload.pop("max_completion_tokens")
        base = (
            "https://api.openai.com/v1"
            if self.settings.provider == "openai"
            else self.settings.api_base
        )
        headers = {}
        if key := self.settings.api_key.get_secret_value():
            headers["Authorization"] = f"Bearer {key}"
        try:
            response = await self.client.post(
                base + "/chat/completions", json=payload, headers=headers, timeout=180
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            if message.get("refusal"):
                raise ExternalError(
                    "The AI provider declined this request. No findings were accepted."
                )
            content = message.get("content")
            if not isinstance(content, str):
                raise ExternalError("The AI provider returned no text response.")
            return parse_response(content, schema)
        except httpx.HTTPStatusError as exc:
            raise ExternalError(
                f"AI provider returned HTTP {exc.response.status_code}. Check credentials, model, and output mode in Settings."
            ) from None
        except httpx.RequestError:
            raise ExternalError("AI provider request failed or timed out. Try again.") from None
        except (KeyError, IndexError, TypeError, ValueError):
            raise ExternalError("AI provider returned an unexpected response format.") from None


class CopilotProvider:
    """Official SDK/CLI transport. No undocumented Copilot HTTP endpoints."""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def generate_structured(self, instructions: str, data: str, schema: type[T]) -> T:
        try:
            from copilot import CopilotClient, SubprocessConfig
            from copilot.session import PermissionRequestResult
        except ImportError:
            raise ExternalError(
                "Install Copilot support with uv sync --extra copilot, then authenticate the Copilot CLI."
            ) from None
        instructions += "\nReturn only JSON matching this schema:\n" + json.dumps(
            strict_schema(schema)
        )

        def deny_permission(request: object, context: object) -> PermissionRequestResult:
            return PermissionRequestResult(kind="reject")

        try:
            async with asyncio.timeout(180):
                # The SDK version is locked in uv.lock; its CLI is a subprocess only for this provider.
                async with CopilotClient(
                    SubprocessConfig(
                        github_token=self.settings.copilot_token.get_secret_value() or None
                    )
                ) as client:
                    session = await client.create_session(
                        model=self.settings.model or "auto",
                        system_message={"mode": "append", "content": instructions},
                        available_tools=[],
                        on_permission_request=deny_permission,
                        enable_config_discovery=False,
                        skill_directories=[],
                        disabled_skills=["*"],
                    )
                    try:
                        response = await session.send_and_wait(data, timeout=170)
                        if response is None or not response.data.content:
                            raise ExternalError("Copilot returned no review output.")
                        return parse_response(response.data.content, schema)
                    finally:
                        await session.destroy()
        except ExternalError:
            raise
        except Exception:
            raise ExternalError(
                "Copilot SDK request failed. Check the installed SDK/CLI, Copilot entitlement, authentication, and model."
            ) from None


def create_provider(settings: Settings, client: httpx.AsyncClient) -> AIProvider:
    if settings.demo:
        from prick.demo import DemoProvider

        return DemoProvider()
    if settings.provider == "copilot":
        return CopilotProvider(settings)
    return OpenAICompatibleProvider(settings, client)
