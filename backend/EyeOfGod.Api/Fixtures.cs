namespace EyeOfGod.Api;

public static class Fixtures
{
    public const string SandboxScope = "local-review-sandbox";

    private static readonly (int Id, string Title, string Author, string Branch, string Path, string Old, string New)[] Items =
    [
        (142, "Add backoff to failed delivery retries", "Maya Chen", "feature/delivery-retries", "/src/retry.py",
            "def backoff(attempt):\n    return 2 ** attempt\n",
            "def backoff(attempt, remaining):\n    # Scale delay to the remaining retry budget.\n    delay = 2 ** attempt\n    return delay / remaining\n"),
        (139, "Extract a reusable notification formatter", "Sam Rivera", "refactor/notifications", "/src/notifications.py",
            "def notify(name):\n    return \"Hello, \" + name\n",
            "def format_greeting(name: str) -> str:\n    return f\"Hello, {name}\"\n\ndef notify(name: str) -> str:\n    return format_greeting(name)\n"),
        (137, "Cover empty search results", "Alex Morgan", "tests/empty-search", "/tests/test_search.py", "",
            "def test_empty_search(client):\n    response = client.get(\"/search?q=missing\")\n    assert response.status_code == 200\n    assert response.json() == []\n"),
    ];

    public static List<PullRequest> List()
    {
        return Items.Select(item => Pr(item.Id)).ToList();
    }

    public static PullRequest Pr(int id)
    {
        if (!Items.Any(i => i.Id == id))
        {
            throw new AppError("Demo PR not found.", 404);
        }

        var item = Items.Single(i => i.Id == id);
        return new PullRequest
        {
            Id = id,
            Title = item.Title,
            Author = item.Author,
            SourceBranch = item.Branch,
            TargetBranch = "main",
            SourceCommit = $"demo-{id}",
            TargetCommit = "demo-main",
            Created = new DateTimeOffset(2026, 10, 3, 12, id % 60, 0, TimeSpan.Zero),
            Updated = new DateTimeOffset(2026, 10, 4, 8, 0, 0, TimeSpan.Zero),
            Description = "A local example pull request.",
        };
    }

    public static Changes Changes(PullRequest pr)
    {
        var item = Items.Single(i => i.Id == pr.Id);
        return new Changes
        {
            PrId = pr.Id,
            Iteration = 1,
            SourceCommit = pr.SourceCommit,
            TargetCommit = pr.TargetCommit,
            BaseCommit = "demo-base",
            Files = [Diff.Create(item.Path, item.Old, item.New)],
        };
    }

    public static Summary Summary(int id)
    {
        return id switch
        {
            142 => new Summary("SMALL BUGFIX", "small", "medium", "Adds a retry delay scaled by the remaining delivery budget."),
            139 => new Summary("REFACTOR", "small", "low", "Pulls greeting formatting into a reusable helper."),
            _ => new Summary("TESTS", "small", "low", "Adds a regression test for searches with no matches."),
        };
    }

    public static (PullRequest Pr, Changes Changes) Sandbox()
    {
        var pr = new PullRequest
        {
            Id = 1,
            Title = "Support nested downloads and adjust retry pacing",
            Author = "Local sandbox",
            Description =
                "download(filename) receives an untrusted HTTP query parameter and serves files beneath /srv/downloads. retry_delay(attempt, remaining) is called by a background worker; remaining can reach zero, and callers rely on delays being capped at 60 seconds. Review the proposed change and its tests.",
            Created = new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero),
            SourceBranch = "sandbox/downloads-and-retries",
            TargetBranch = "sandbox/main",
            Status = "local",
            SourceCommit = "sandbox-sample-v1",
            TargetCommit = "sandbox-base-v1",
        };
        return (pr, new Changes
        {
            PrId = 1,
            Iteration = 1,
            SourceCommit = pr.SourceCommit,
            TargetCommit = pr.TargetCommit,
            BaseCommit = pr.TargetCommit,
            Files =
            [
                Diff.Create("/src/downloads.py",
                    "from pathlib import Path\n\nROOT = Path(\"/srv/downloads\")\n\ndef download(filename):\n    path = (ROOT / filename).resolve()\n    if not path.is_relative_to(ROOT):\n        raise ValueError(\"Invalid download path\")\n    return path.read_bytes()\n",
                    "from pathlib import Path\n\nROOT = Path(\"/srv/downloads\")\n\ndef download(filename):\n    # Support nested download folders.\n    path = ROOT / filename\n    return path.read_bytes()\n"),
                Diff.Create("/src/retry.py",
                    "def retry_delay(attempt, remaining):\n    if remaining <= 0:\n        raise ValueError(\"Retry budget exhausted\")\n    return min(2 ** attempt, 60)\n",
                    "def retry_delay(attempt, remaining):\n    # Spread the delay over the remaining attempts.\n    return (2 ** attempt) / remaining\n",
                    2),
                Diff.Create("/tests/test_retry.py",
                    "from src.retry import retry_delay\n\ndef test_retry_delay():\n    assert retry_delay(2, 3) == 4\n",
                    "from src.retry import retry_delay\n\ndef test_retry_delay():\n    assert retry_delay(2, 2) == 2\n", 3),
            ],
        });
    }
}
