from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewOptions(Model):
    thoroughness: int = Field(default=5, ge=1, le=10)
    nitpicking: int = Field(default=3, ge=1, le=10)
    conventions: int = Field(default=5, ge=1, le=10)
    tone: int = Field(default=5, ge=1, le=10)
    archaic_english: int = Field(default=0, ge=0, le=10)


class Summary(Model):
    classification: Literal[
        "SMALL BUGFIX", "LARGE FEATURE", "REFACTOR", "CLEANUP", "CONFIGURATION", "TESTS", "MIXED"
    ]
    size: Literal["small", "medium", "large"]
    risk: Literal["low", "medium", "high"]
    description: str = Field(min_length=1, max_length=500)


class PullRequest(Model):
    id: int
    title: str
    description: str = ""
    author: str
    created: datetime
    updated: datetime | None = None
    source_branch: str
    target_branch: str
    status: str
    source_commit: str
    target_commit: str
    draft: bool = False
    url: str = ""
    summary: Summary | None = None


class DiffLine(Model):
    kind: Literal["context", "add", "delete", "hunk"]
    text: str
    old: int | None = None
    new: int | None = None


class FileChange(Model):
    path: str
    old_path: str
    change_type: str
    tracking_id: int
    lines: list[DiffLine] = Field(default_factory=list)
    additions: int = 0
    deletions: int = 0
    skipped_reason: str | None = None


class Changes(Model):
    pr_id: int
    iteration: int
    source_commit: str
    target_commit: str
    base_commit: str
    files: list[FileChange]

    @property
    def additions(self) -> int:
        return sum(f.additions for f in self.files)

    @property
    def deletions(self) -> int:
        return sum(f.deletions for f in self.files)


class Finding(Model):
    file: str = Field(min_length=1, max_length=1000)
    side: Literal["left", "right"]
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    severity: Literal["nit", "suggestion", "warning", "must-fix"]
    category: Literal[
        "bug",
        "security",
        "performance",
        "error-handling",
        "maintainability",
        "convention",
        "style",
        "tests",
    ]
    explanation: str = Field(min_length=1, max_length=6000)
    suggested_change: str | None = Field(max_length=6000)

    @model_validator(mode="after")
    def ordered_range(self) -> Finding:
        if self.line_end < self.line_start or self.line_end - self.line_start > 30:
            raise ValueError("Findings must cite an ordered range of at most 31 lines")
        return self


class Analysis(Model):
    overview: str = Field(min_length=1, max_length=3000)
    findings: list[Finding] = Field(max_length=100)


class StyledComment(Model):
    index: int = Field(ge=0)
    comment: str = Field(min_length=1, max_length=12000)


class StyledComments(Model):
    comments: list[StyledComment] = Field(max_length=100)


class ReviewFinding(Model):
    id: str = Field(default_factory=lambda: uuid4().hex)
    finding: Finding
    comment: str
    decision: Literal["draft", "approved", "ignored"] = "draft"
    publish_state: Literal["unpublished", "publishing", "published", "uncertain"] = "unpublished"
    thread_id: int | None = None


class Review(Model):
    id: str = Field(default_factory=lambda: uuid4().hex)
    scope: str
    pr_id: int
    created: datetime
    options: ReviewOptions
    provider: str
    model: str
    changes: Changes
    overview: str
    findings: list[ReviewFinding]
    warnings: list[str] = Field(default_factory=list)
