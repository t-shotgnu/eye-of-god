from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator

from prick.models import Model, ReviewOptions


class Settings(Model):
    demo: bool = True
    organization: str = ""
    project: str = ""
    repository: str = ""
    azure_pat: SecretStr = SecretStr("")
    provider: Literal["openai", "compatible", "copilot"] = "openai"
    model: str = ""
    api_base: str = "https://api.openai.com/v1"
    api_key: SecretStr = SecretStr("")
    structured_mode: Literal["schema", "json", "prompt"] = "schema"
    copilot_token: SecretStr = SecretStr("")
    profanity: bool = False
    repository_instructions: str = Field(default="", max_length=20000)
    defaults: ReviewOptions = Field(default_factory=ReviewOptions)

    @field_validator("organization")
    @classmethod
    def organization_name(cls, value: str) -> str:
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("Enter an organization name, not a URL")
        return value

    @field_validator("api_base")
    @classmethod
    def valid_endpoint(cls, value: str) -> str:
        parts = urlsplit(value)
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
        ):
            raise ValueError(
                "API base must be an HTTP(S) URL without credentials, query or fragment"
            )
        return value.rstrip("/")

    @property
    def scope(self) -> str:
        return "demo" if self.demo else f"{self.organization}/{self.project}/{self.repository}"

    def require_azure(self) -> None:
        if not all(
            [self.organization, self.project, self.repository, self.azure_pat.get_secret_value()]
        ):
            raise ValueError(
                "Configure Azure DevOps organization, project, repository and PAT in Settings"
            )


SECRET_ENV = {
    "azure_pat": "PRICK_AZURE_PAT",
    "api_key": "PRICK_API_KEY",
    "copilot_token": "PRICK_COPILOT_TOKEN",
}
ENV_FIELDS = {
    "organization": "PRICK_AZURE_ORGANIZATION",
    "project": "PRICK_AZURE_PROJECT",
    "repository": "PRICK_AZURE_REPOSITORY",
    "provider": "PRICK_PROVIDER",
    "model": "PRICK_MODEL",
    "api_base": "PRICK_API_BASE",
    "demo": "PRICK_DEMO",
}


def data_directory() -> Path:
    return Path(os.environ.get("PRICK_DATA_DIR", ".data")).resolve()


def load_settings(directory: Path) -> Settings:
    path = directory / "settings.json"
    values = (
        Settings.model_validate_json(path.read_text("utf-8")).model_dump() if path.exists() else {}
    )
    for field, env in (ENV_FIELDS | SECRET_ENV).items():
        if env in os.environ:
            values[field] = os.environ[env]
    return Settings.model_validate(values)


def save_settings(directory: Path, settings: Settings) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    values = settings.model_dump(mode="json")
    for field in SECRET_ENV:
        values[field] = getattr(settings, field).get_secret_value()
    # Never copy environment-managed credentials or settings into the local file.
    path = directory / "settings.json"
    previous = json.loads(path.read_text("utf-8")) if path.exists() else {}
    defaults = Settings().model_dump(mode="json")
    for field, env in (ENV_FIELDS | SECRET_ENV).items():
        if env in os.environ:
            values[field] = previous.get(field, "" if field in SECRET_ENV else defaults[field])
    temporary = directory / "settings.json.tmp"
    temporary.write_text(json.dumps(values, indent=2), "utf-8")
    temporary.chmod(0o600)
    temporary.replace(directory / "settings.json")
