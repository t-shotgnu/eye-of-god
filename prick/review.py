from __future__ import annotations

import json
import re
from datetime import UTC, datetime

from prick.azure import ExternalError
from prick.config import Settings
from prick.models import (
    Analysis,
    Changes,
    Finding,
    PullRequest,
    Review,
    ReviewFinding,
    ReviewOptions,
    StyledComments,
)
from prick.prompts import limited_changes, review_data, review_instructions, tone_instructions
from prick.providers import AIProvider


def finding_error(finding: Finding, changes: Changes) -> str | None:
    change = next((f for f in changes.files if f.path == finding.file), None)
    if not change or change.skipped_reason:
        return "File is not among the supplied reviewable changes."
    numbers = {line.new if finding.side == "right" else line.old for line in change.lines}
    required = set(range(finding.line_start, finding.line_end + 1))
    if not required.issubset(numbers):
        return "Line range is not visible in the supplied diff."
    kind = "add" if finding.side == "right" else "delete"
    changed = {
        line.new if finding.side == "right" else line.old
        for line in change.lines
        if line.kind == kind
    }
    if not required.intersection(changed):
        return "Finding does not touch a changed line."
    return None


def neutral_comment(finding: Finding) -> str:
    value = f"[{finding.severity}] {finding.explanation}"
    if finding.suggested_change:
        value += "\n\nSuggested change:\n" + finding.suggested_change
    return value


def protected_tokens(finding: Finding) -> list[str]:
    """Keep code spans, identifiers and paths verbatim during presentation rewriting."""
    text = finding.explanation + "\n" + (finding.suggested_change or "")
    patterns = [
        r"```[\s\S]*?```",
        r"`[^`\n]+`",
        r"\b[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+\b",  # PascalCase
        r"\b[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b",  # camelCase
        r"\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b",  # snake_case
        r"\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+\b",  # dotted APIs / filenames
        r"(?<!\w)/[A-Za-z0-9_./-]+",  # repository and URL paths
    ]
    return sorted({match for pattern in patterns for match in re.findall(pattern, text)})


def presentation_is_valid(comment: str, finding: Finding) -> bool:
    return all(token in comment for token in protected_tokens(finding))


async def generate_review(
    pr: PullRequest,
    changes: Changes,
    options: ReviewOptions,
    settings: Settings,
    provider: AIProvider,
) -> Review:
    supplied, warnings = limited_changes(changes)
    if not any(line.kind in {"add", "delete"} for f in supplied.files for line in f.lines):
        raise ExternalError(
            "No reviewable text changes were available. Check file exclusions in the diff."
        )
    analysis = await provider.generate_structured(
        review_instructions(options, settings.repository_instructions),
        review_data(pr, supplied),
        Analysis,
    )
    valid: list[Finding] = []
    seen: set[str] = set()
    for finding in analysis.findings:
        if error := finding_error(finding, supplied):
            warnings.append(f"Rejected an AI finding: {error}")
            continue
        signature = finding.model_dump_json()
        if signature not in seen:
            valid.append(finding)
            seen.add(signature)
    comments = [neutral_comment(finding) for finding in valid]
    if valid and (options.tone != 5 or options.archaic_english != 0):
        try:
            styled = await provider.generate_structured(
                tone_instructions(options.tone, settings.profanity, options.archaic_english),
                json.dumps(
                    {
                        "findings": [
                            {
                                "index": i,
                                "finding": f.model_dump(),
                                "protected_tokens": protected_tokens(f),
                            }
                            for i, f in enumerate(valid)
                        ],
                        "presentation": {
                            "tone": options.tone,
                            "archaic_english": options.archaic_english,
                        },
                    }
                ),
                StyledComments,
            )
            indices = [c.index for c in styled.comments]
            if len(indices) != len(valid) or set(indices) != set(range(len(valid))):
                raise ExternalError("Presentation response did not preserve finding identities.")
            for comment in styled.comments:
                finding = valid[comment.index]
                if presentation_is_valid(comment.comment, finding):
                    comments[comment.index] = f"[{finding.severity}] {comment.comment}"
                else:
                    warnings.append(
                        "Presentation changed a protected identifier or code span; the original professional comment was retained."
                    )
        except ExternalError:
            warnings.append(
                "Presentation rewriting failed validation; original professional comments were retained."
            )
    return Review(
        scope=settings.scope,
        pr_id=pr.id,
        created=datetime.now(UTC),
        options=options,
        provider="demo" if settings.demo else settings.provider,
        model="fixture" if settings.demo else settings.model,
        changes=supplied,
        overview=analysis.overview,
        findings=[
            ReviewFinding(finding=f, comment=c) for f, c in zip(valid, comments, strict=True)
        ],
        warnings=warnings,
    )


def same_revision(before: Changes, after: Changes) -> bool:
    return (before.iteration, before.source_commit, before.target_commit, before.base_commit) == (
        after.iteration,
        after.source_commit,
        after.target_commit,
        after.base_commit,
    )
