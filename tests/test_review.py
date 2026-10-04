import json

import pytest
from pydantic import ValidationError

from prick.azure import ExternalError, make_diff
from prick.config import Settings
from prick.demo import DemoAzure, DemoProvider
from prick.models import (
    Analysis,
    Changes,
    FileChange,
    Finding,
    ReviewOptions,
    StyledComments,
    Summary,
)
from prick.prompts import limited_changes, review_instructions, tone_instructions
from prick.providers import parse_response, strict_schema
from prick.review import finding_error, generate_review, protected_tokens


def change_fixture():
    lines, add, delete = make_diff("a\nb\nc\n", "a\nchanged\nc\n")
    return Changes(
        pr_id=1,
        iteration=2,
        source_commit="new",
        target_commit="target",
        base_commit="old",
        files=[
            FileChange(
                path="/app.py",
                old_path="/app.py",
                tracking_id=1,
                change_type="edit",
                lines=lines,
                additions=add,
                deletions=delete,
            )
        ],
    )


def finding(**changes):
    values = {
        "file": "/app.py",
        "side": "right",
        "line_start": 2,
        "line_end": 2,
        "severity": "warning",
        "category": "bug",
        "explanation": "Changed value can break the contract.",
        "suggested_change": None,
    }
    return Finding.model_validate(values | changes)


def test_options_are_independent_and_tone_is_absent_from_detection():
    first = ReviewOptions(thoroughness=1, nitpicking=10, conventions=8, tone=1)
    second = first.model_copy(update={"tone": 10})
    assert review_instructions(first, "Use async I/O") == review_instructions(
        second, "Use async I/O"
    )
    prompt = review_instructions(first, "Use async I/O")
    assert "Thoroughness: 1/10" in prompt and "Nitpicking: 10/10" in prompt
    assert "Use async I/O" in prompt and "Do not invent" in prompt
    assert "Do not use profanity" in tone_instructions(10, False)
    assert "Profanity is allowed" in tone_instructions(10, True)
    with pytest.raises(ValidationError):
        ReviewOptions(tone=11)


def test_archaic_english_is_independent_bounded_and_absent_from_analysis():
    base = ReviewOptions()
    assert base.archaic_english == 0
    for tone in [1, 5, 10]:
        for archaic in [0, 2, 5, 8, 10]:
            options = base.model_copy(update={"tone": tone, "archaic_english": archaic})
            assert review_instructions(options, "Use async I/O") == review_instructions(
                base, "Use async I/O"
            )
            presentation = tone_instructions(tone, False, archaic)
            assert f"Tone {tone}/10" in presentation
            assert f"Archaic English {archaic}/10" in presentation
            assert "Preserve all code, identifiers, paths" in presentation
    for value in [-1, 11]:
        with pytest.raises(ValidationError):
            ReviewOptions(archaic_english=value)


async def test_demo_presentation_changes_without_changing_any_technical_finding():
    azure, provider = DemoAzure(), DemoProvider()
    pr = await azure.get_pr(142)
    changes = await azure.changes(pr)
    results = {}
    for tone, archaic in [
        (5, 0),
        (1, 0),
        (10, 0),
        (5, 2),
        (5, 5),
        (5, 8),
        (5, 10),
        (1, 8),
        (10, 8),
        (1, 10),
        (10, 10),
    ]:
        result = await generate_review(
            pr, changes, ReviewOptions(tone=tone, archaic_english=archaic), Settings(), provider
        )
        results[tone, archaic] = result
    neutral = results[5, 0].findings[0].finding.model_dump()
    for result in results.values():
        assert len(result.findings) == 1
        assert result.findings[0].finding.model_dump() == neutral
        assert "ZeroDivisionError" in result.findings[0].comment
        assert result.findings[0].decision == "draft"
        assert result.findings[0].publish_state == "unpublished"
        assert not result.warnings
    assert "thou" not in results[10, 0].findings[0].comment.lower()
    assert "Behold" in results[5, 10].findings[0].comment
    assert "þonne" in results[5, 10].findings[0].comment
    assert "oþþe" in results[5, 10].findings[0].comment
    assert results[1, 10].findings[0].comment != results[10, 10].findings[0].comment
    assert results[1, 8].findings[0].comment != results[10, 8].findings[0].comment
    assert results[5, 0].findings[0].comment != results[5, 10].findings[0].comment


@pytest.mark.parametrize(
    "replacement", ["CancellationToken", "Task.Delay", "SendAsync", "userId", "/api/users"]
)
async def test_presentation_rejects_changed_identifiers_and_keeps_neutral_source(replacement):
    original = finding(
        explanation="Pass the `CancellationToken` to `Task.Delay` before calling `SendAsync` for `userId` at `/api/users`.",
        suggested_change="Use `await SendAsync(userId)` with the supplied token.",
    )
    text = original.explanation + " " + original.suggested_change
    assert {"CancellationToken", "Task.Delay", "SendAsync", "userId", "/api/users"}.issubset(
        set(protected_tokens(original)) | {token.strip("`") for token in protected_tokens(original)}
    )

    class Provider:
        async def generate_structured(self, instructions, data, schema):
            if schema is Analysis:
                return Analysis(overview="Analysis", findings=[original])
            return StyledComments.model_validate(
                {
                    "comments": [
                        {"index": 0, "comment": text.replace(replacement, "ancient_replacement")}
                    ]
                }
            )

    pr = await DemoAzure().get_pr(142)
    result = await generate_review(
        pr, change_fixture(), ReviewOptions(tone=5, archaic_english=10), Settings(), Provider()
    )
    assert result.findings[0].finding == original
    assert (
        result.findings[0].comment
        == "[warning] "
        + original.explanation
        + "\n\nSuggested change:\n"
        + original.suggested_change
    )
    assert "protected identifier" in result.warnings[0]


async def test_archaic_only_triggers_presentation_and_preserves_code_blocks():
    original = finding(
        explanation="Pass `CancellationToken` to `Task.Delay`.",
        suggested_change="```csharp\nawait Task.Delay(delay, cancellationToken);\n```",
    )
    seen = []

    class Provider:
        async def generate_structured(self, instructions, data, schema):
            seen.append(schema)
            if schema is Analysis:
                assert "Archaic English" not in instructions and "Tone 5" not in instructions
                return Analysis(overview="Analysis", findings=[original])
            assert "Tone 5/10" in instructions and "Archaic English 10/10" in instructions
            raw = json.loads(data)
            assert original.suggested_change in raw["findings"][0]["protected_tokens"]
            return StyledComments.model_validate(
                {
                    "comments": [
                        {
                            "index": 0,
                            "comment": "Thou shalt pass `CancellationToken` unto `Task.Delay`.\n"
                            + original.suggested_change,
                        }
                    ]
                }
            )

    pr = await DemoAzure().get_pr(142)
    result = await generate_review(
        pr, change_fixture(), ReviewOptions(archaic_english=10), Settings(), Provider()
    )
    assert seen == [Analysis, StyledComments]
    assert original.suggested_change in result.findings[0].comment and not result.warnings


def test_finding_validation_checks_exact_path_side_and_visible_changed_range():
    changes = change_fixture()
    assert finding_error(finding(), changes) is None
    assert finding_error(finding(side="left"), changes) is None
    assert finding_error(finding(file="app.py"), changes)
    assert finding_error(finding(file="/other.py"), changes)
    assert finding_error(finding(line_start=99, line_end=99), changes)
    assert finding_error(
        finding(line_start=1, line_end=1), changes
    )  # Context alone is not a change.
    assert finding_error(finding(line_start=1, line_end=3), changes) is None
    with pytest.raises(ValidationError):
        finding(line_start=5, line_end=1)


def test_deleted_file_is_valid_only_on_left():
    lines, add, delete = make_diff("remove me\n", "")
    changes = change_fixture().model_copy(
        update={
            "files": [
                FileChange(
                    path="/app.py",
                    old_path="/app.py",
                    tracking_id=1,
                    change_type="delete",
                    lines=lines,
                    additions=add,
                    deletions=delete,
                )
            ]
        }
    )
    assert finding_error(finding(side="left", line_start=1, line_end=1), changes) is None
    assert finding_error(finding(line_start=1, line_end=1), changes)


def test_budget_validation_excludes_unsupplied_evidence():
    source = change_fixture()
    supplied, warnings = limited_changes(source, budget=1)
    assert warnings and not supplied.files[0].lines
    assert finding_error(finding(), supplied)


def test_json_parsing_rejects_bad_types_unknown_fields_and_extra_prose():
    valid = {
        "classification": "TESTS",
        "size": "small",
        "risk": "low",
        "description": "Tests a feature.",
    }
    assert parse_response("```json\n" + json.dumps(valid) + "\n```", Summary).size == "small"
    for content in [
        "not json",
        json.dumps(valid | {"risk": "invented"}),
        json.dumps(valid | {"extra": 1}),
        "Explanation: " + json.dumps(valid),
    ]:
        with pytest.raises(ExternalError):
            parse_response(content, Summary)
    schema = strict_schema(Analysis)
    assert schema["additionalProperties"] is False
    assert schema["$defs"]["Finding"]["required"] == list(schema["$defs"]["Finding"]["properties"])


async def test_rejected_findings_and_bad_tone_keep_neutral_validated_facts():
    class Provider:
        async def generate_structured(self, instructions, data, schema):
            if schema is Analysis:
                return Analysis(
                    overview="Analysis", findings=[finding(), finding(file="/made-up.py")]
                )
            assert schema is StyledComments
            return StyledComments.model_validate(
                {"comments": [{"index": 99, "comment": "Invented identity"}]}
            )

    pr = await DemoAzure().get_pr(142)
    review = await generate_review(
        pr, change_fixture(), ReviewOptions(tone=10), Settings(), Provider()
    )
    assert len(review.findings) == 1 and len(review.warnings) == 2
    assert review.findings[0].comment == "[warning] Changed value can break the contract."
    assert review.findings[0].decision == "draft"
