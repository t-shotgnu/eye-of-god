from __future__ import annotations

import json
from datetime import UTC, datetime

from prick.azure import make_diff
from prick.models import (
    Analysis,
    Changes,
    FileChange,
    Finding,
    PullRequest,
    StyledComment,
    StyledComments,
    Summary,
)
from prick.providers import T

FIXTURES = {
    142: (
        "Add backoff to failed delivery retries",
        "Maya Chen",
        "feature/delivery-retries",
        "/src/retry.py",
        "def backoff(attempt):\n    return 2 ** attempt\n",
        "def backoff(attempt, remaining):\n    # Scale delay to the remaining retry budget.\n    delay = 2 ** attempt\n    return delay / remaining\n",
    ),
    139: (
        "Extract a reusable notification formatter",
        "Sam Rivera",
        "refactor/notifications",
        "/src/notifications.py",
        'def notify(name):\n    return "Hello, " + name\n',
        'def format_greeting(name: str) -> str:\n    return f"Hello, {name}"\n\ndef notify(name: str) -> str:\n    return format_greeting(name)\n',
    ),
    137: (
        "Cover empty search results",
        "Alex Morgan",
        "tests/empty-search",
        "/tests/test_search.py",
        "",
        'def test_empty_search(client):\n    response = client.get("/search?q=missing")\n    assert response.status_code == 200\n    assert response.json() == []\n',
    ),
}


class DemoAzure:
    async def list_prs(self) -> list[PullRequest]:
        return [await self.get_pr(pr_id) for pr_id in FIXTURES]

    async def get_pr(self, pr_id: int) -> PullRequest:
        if pr_id not in FIXTURES:
            raise ValueError("Demo PR not found")
        title, author, branch, *_ = FIXTURES[pr_id]
        return PullRequest(
            id=pr_id,
            title=title,
            author=author,
            created=datetime(2026, 10, 3, 12, pr_id % 60, tzinfo=UTC),
            updated=datetime(2026, 10, 4, 8, tzinfo=UTC),
            description="A local example PR. Connect Azure DevOps in Settings to review your own code.",
            source_branch=branch,
            target_branch="main",
            status="active",
            source_commit=f"demo-{pr_id}",
            target_commit="demo-main",
        )

    async def changes(self, pr: PullRequest) -> Changes:
        *_, path, old, new = FIXTURES[pr.id]
        lines, additions, deletions = make_diff(old, new)
        return Changes(
            pr_id=pr.id,
            iteration=1,
            source_commit=pr.source_commit,
            target_commit=pr.target_commit,
            base_commit="demo-base",
            files=[
                FileChange(
                    path=path,
                    old_path=path,
                    change_type="edit" if old else "add",
                    tracking_id=1,
                    lines=lines,
                    additions=additions,
                    deletions=deletions,
                )
            ],
        )


class DemoProvider:
    async def generate_structured(self, instructions: str, data: str, schema: type[T]) -> T:
        raw = json.loads(data)
        if schema is Summary:
            pr_id = raw["pr"]["id"]
            return schema.model_validate(
                {
                    "classification": {142: "SMALL BUGFIX", 139: "REFACTOR", 137: "TESTS"}[pr_id],
                    "size": "small",
                    "risk": "medium" if pr_id == 142 else "low",
                    "description": {
                        142: "Adds a retry delay scaled by the remaining delivery budget.",
                        139: "Pulls greeting formatting into a reusable helper.",
                        137: "Adds a regression test for searches with no matches.",
                    }[pr_id],
                }
            )
        if schema is Analysis:
            findings = []
            if raw["pr"]["id"] == 142:
                findings = [
                    Finding(
                        file="/src/retry.py",
                        side="right",
                        line_start=4,
                        line_end=4,
                        severity="warning",
                        category="bug",
                        explanation="When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling.",
                        suggested_change="Handle an exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception.",
                    )
                ]
            return schema.model_validate(
                Analysis(
                    overview="The retry budget can reach zero before the backoff calculation. An explicit exhausted-budget case is needed."
                    if findings
                    else "No supported findings in the supplied changes.",
                    findings=findings,
                ).model_dump()
            )
        if schema is StyledComments:
            presentation = raw.get("presentation", {})
            tone = presentation.get("tone", 5)
            archaic = presentation.get("archaic_english", 0)
            wording = (
                "When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling. Handle an exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception."
                if archaic == 0
                else "When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling. Handle an exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception, lest delivery handling be interrupted."
                if archaic <= 3
                else "When remaining is zero, the backoff calculation doth raise ZeroDivisionError and interrupt delivery handling. Handle the exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception."
                if archaic <= 6
                else "Thou shalt handle the exhausted retry budget before dividing: when remaining is zero, this backoff calculation doth raise ZeroDivisionError and interrupt delivery handling. Return a terminal result or raise a deliberate domain exception."
                if archaic <= 9
                else "Behold: when remaining is zero, the backoff calculation doth raise ZeroDivisionError, thereby interrupting delivery handling. Thou shalt handle the exhausted retry budget ere dividing; return a terminal result or raise a deliberate domain exception, lest delivery handling be interrupted."
            )
            if tone <= 3:
                wording = (
                    "Pray, consider this safeguard. "
                    if archaic
                    else "Please consider adding this safeguard. "
                ) + wording
            elif tone >= 8:
                wording = (
                    "Let this be remedied. "
                    if archaic
                    else "Zero is still not a valid divisor. Handle it explicitly. "
                ) + wording
            comments = [
                StyledComment(
                    index=item["index"],
                    comment=wording,
                )
                for item in raw["findings"]
            ]
            return schema.model_validate(StyledComments(comments=comments).model_dump())
        raise ValueError("Unsupported demo output schema")
