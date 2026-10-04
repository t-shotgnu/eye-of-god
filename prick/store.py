from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from prick.models import Review, Summary


class Store:
    """Two JSON tables keep local reviews and inexpensive summaries across restarts."""

    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "reviews.sqlite3"
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS reviews (
                    id TEXT PRIMARY KEY, scope TEXT NOT NULL, pr_id INTEGER NOT NULL,
                    created TEXT NOT NULL, body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS review_pr ON reviews(scope, pr_id, created);
                CREATE TABLE IF NOT EXISTS summaries (key TEXT PRIMARY KEY, body TEXT NOT NULL);
            """)
            # A process exit during posting leaves the remote outcome unknown. Never retry silently.
            for row in db.execute("SELECT id, body FROM reviews").fetchall():
                review = Review.model_validate_json(row[1])
                if any(f.publish_state == "publishing" for f in review.findings):
                    for finding in review.findings:
                        if finding.publish_state == "publishing":
                            finding.publish_state = "uncertain"
                    db.execute(
                        "UPDATE reviews SET body=? WHERE id=?",
                        (review.model_dump_json(), review.id),
                    )

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        with sqlite3.connect(self.path, timeout=10) as db:
            yield db

    def save_review(self, review: Review) -> None:
        with self.connection() as db:
            db.execute(
                "INSERT OR REPLACE INTO reviews VALUES (?, ?, ?, ?, ?)",
                (
                    review.id,
                    review.scope,
                    review.pr_id,
                    review.created.isoformat(),
                    review.model_dump_json(),
                ),
            )

    def review(self, review_id: str, scope: str, pr_id: int) -> Review | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT body FROM reviews WHERE id=? AND scope=? AND pr_id=?",
                (review_id, scope, pr_id),
            ).fetchone()
        return Review.model_validate_json(row[0]) if row else None

    def reviews(self, scope: str, pr_id: int) -> list[Review]:
        with self.connection() as db:
            rows = db.execute(
                "SELECT body FROM reviews WHERE scope=? AND pr_id=? ORDER BY created DESC LIMIT 10",
                (scope, pr_id),
            ).fetchall()
        return [Review.model_validate_json(row[0]) for row in rows]

    def summary(self, key: str) -> Summary | None:
        with self.connection() as db:
            row = db.execute("SELECT body FROM summaries WHERE key=?", (key,)).fetchone()
        return Summary.model_validate_json(row[0]) if row else None

    def save_summary(self, key: str, summary: Summary) -> None:
        with self.connection() as db:
            db.execute(
                "INSERT OR REPLACE INTO summaries VALUES (?, ?)", (key, summary.model_dump_json())
            )
