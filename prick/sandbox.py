"""Inert sample sources for the local AI review sandbox; never executed."""

from datetime import UTC, datetime

from prick.azure import make_diff
from prick.models import Changes, FileChange, PullRequest

SCOPE = "local-review-sandbox"
PR_ID = 1
SOURCES = [
    (
        "/src/downloads.py",
        'from pathlib import Path\n\nROOT = Path("/srv/downloads")\n\ndef download(filename):\n    path = (ROOT / filename).resolve()\n    if not path.is_relative_to(ROOT):\n        raise ValueError("Invalid download path")\n    return path.read_bytes()\n',
        'from pathlib import Path\n\nROOT = Path("/srv/downloads")\n\ndef download(filename):\n    # Support nested download folders.\n    path = ROOT / filename\n    return path.read_bytes()\n',
    ),
    (
        "/src/retry.py",
        'def retry_delay(attempt, remaining):\n    if remaining <= 0:\n        raise ValueError("Retry budget exhausted")\n    return min(2 ** attempt, 60)\n',
        "def retry_delay(attempt, remaining):\n    # Spread the delay over the remaining attempts.\n    return (2 ** attempt) / remaining\n",
    ),
    (
        "/tests/test_retry.py",
        "from src.retry import retry_delay\n\ndef test_retry_delay():\n    assert retry_delay(2, 3) == 4\n",
        "from src.retry import retry_delay\n\ndef test_retry_delay():\n    assert retry_delay(2, 2) == 2\n",
    ),
]


def sample() -> tuple[PullRequest, Changes]:
    pr = PullRequest(
        id=PR_ID,
        title="Support nested downloads and adjust retry pacing",
        description=(
            "Sample Python service: download(filename) receives an untrusted HTTP query "
            "parameter and serves files beneath /srv/downloads. retry_delay(attempt, remaining) "
            "is called by a background worker; remaining can reach zero, and callers rely "
            "on delays being capped at 60 seconds. Review the proposed change and its tests. "
            "These source files are inert text and are never executed."
        ),
        author="Local sandbox",
        created=datetime(2026, 10, 4, tzinfo=UTC),
        source_branch="sandbox/downloads-and-retries",
        target_branch="sandbox/main",
        status="local",
        source_commit="sandbox-sample-v1",
        target_commit="sandbox-base-v1",
    )
    files = []
    for index, (path, old, new) in enumerate(SOURCES, start=1):
        lines, additions, deletions = make_diff(old, new)
        files.append(
            FileChange(
                path=path,
                old_path=path,
                change_type="edit",
                tracking_id=index,
                lines=lines,
                additions=additions,
                deletions=deletions,
            )
        )
    return pr, Changes(
        pr_id=PR_ID,
        iteration=1,
        source_commit=pr.source_commit,
        target_commit=pr.target_commit,
        base_commit=pr.target_commit,
        files=files,
    )
