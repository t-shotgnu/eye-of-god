# Eye of God

The all-seeing reviewer. A small, self-hosted AI review tool for **Azure DevOps Services / Azure Repos Git**. One FastAPI process, Jinja2 pages, locally bundled HTMX, httpx, and SQLite for saved review decisions. No frontend build, queue, or separate service.

## Start with uv

Requires [uv](https://docs.astral.sh/uv/) and Python 3.13+. uv installs Python if needed.

```sh
uv sync
uv run uvicorn prick.app:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The default **demo workspace** has three sample PRs and a complete simulated review/publishing flow. No credentials or paid AI calls are needed for the demo. Its output is deterministic example data, not AI analysis.

## Connect your repository

In **Settings**, turn off demo mode and enter your organization **name**, project, repository name or ID, and PAT. Use code read permission to retrieve PRs and changes; posting threads also requires the relevant code/review thread write permission. The app uses Azure's REST API 7.1, immutable commit content, and PR iteration change tracking. Azure DevOps Server/custom hostnames and PRs without iterations are outside this MVP.

Choose an AI provider and a model available to your account:

| Provider | Setup |
| --- | --- |
| OpenAI | API key + model ID. Uses the official Chat Completions endpoint and JSON Schema output. |
| OpenAI-compatible / local | Base URL including `/v1`, model ID, optional key. For example an Ollama OpenAI-compatible server. Choose JSON object or prompt-only mode if the server lacks JSON Schema support. |
| GitHub Copilot | `uv sync --extra copilot`, a Copilot-enabled account, and CLI authentication or a supported GitHub token in Settings. Blank model uses `auto`. |

The optional Copilot adapter uses the **official `github-copilot-sdk`**, pinned to 0.3.0 in `uv.lock`, with its bundled CLI subprocess. It disables tools, project config discovery, and skills and denies permission requests. It does not use undocumented HTTP endpoints or reuse an OpenAI key as a Copilot token. If using an external CLI, set `COPILOT_CLI_PATH` to a compatible executable. Follow GitHub's [official authentication/setup guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/local-cli) for supported token types and account requirements. The web app still runs in one process; Copilot's official transport adds its CLI child process when selected.

Settings are saved to ignored `.data/settings.json`; reviews, edited comments, and summaries are stored in `.data/reviews.sqlite3`. Secrets are never filled into HTML password fields. Leave a credential blank to keep it; use its clear checkbox to remove it. The local JSON file contains plaintext credentials, so protect the data directory with your normal OS permissions. Environment-supplied credentials are not copied into it.

Alternatively export `PRICK_AZURE_ORGANIZATION`, `PRICK_AZURE_PROJECT`, `PRICK_AZURE_REPOSITORY`, `PRICK_AZURE_PAT`, `PRICK_PROVIDER`, `PRICK_MODEL`, `PRICK_API_KEY`, `PRICK_API_BASE`, `PRICK_COPILOT_TOKEN`, and `PRICK_DEMO=false` before starting. Environment variables override the Settings screen. `.env.example` lists them; `.env` files are **not automatically loaded**. `PRICK_DATA_DIR` changes the local data directory.

## Review workflow

1. Open a PR from the dashboard. Its cached classification uses a small diff sample and a short model response, rather than a full review.
2. Inspect its metadata, numbered diff, and inline findings. Configure independent **Thoroughness**, **Nitpicking**, **Conventions**, and **Tone** values from 1–10, plus **Archaic English** from 0–10 (default 0).
3. Press **Seek judgement**. Repository instructions and detection controls are assembled separately. Tone and Archaic English never enter the detection prompt: a separate presentation call rewrites validated findings when tone differs from 5 or Archaic English differs from 0. Original neutral findings and recommendations remain available for comparison.
4. Edit comments, save drafts, dismiss findings, or explicitly approve them. Approving saves the text; it does not publish.
5. Choose **Publish this** or **Publish approved**, inspect the exact saved comments in the preview, then press **Publish**. The app rejects changed previews, stale source/target revisions, invalid line locations, and already-published comments.

Each finding includes file, old/new side, range, severity, category, explanation, and optional suggestion. JSON is validated with Pydantic. Paths must exactly match supplied files, every cited line must be in the model's numbered diff, and ranges must touch a changed line. Invalid locations are rejected with a visible warning. Presentation output must preserve finding count, identities, protected identifiers, paths, inline code spans, and fenced code blocks. A failed rewrite retains the neutral wording. The neutral structured finding is never modified by either presentation control. AI text still needs your judgment, including checking that a rewrite preserves its technical meaning.

Publishing stores each result before moving to the next comment. A timeout or process interruption may mean Azure accepted a request without returning a response. Such comments are marked **uncertain** and blocked from re-posting. Check Azure manually; there is no automatic retry of comment creation. Previously successful comments remain recorded. Azure can still change during a batch; the revision check runs immediately before posting, but the remote API has no atomic batch/revision precondition here.

Archaic English changes the surrounding natural language: 0 is modern, 2 is faintly ancient, 5 is noticeably archaic, 8 is strongly Early Modern English, and 10 is the ancient tongue. Code and API names such as `CancellationToken`, `Task.Delay`, `SendAsync`, `userId`, and `/api/users` stay verbatim. Existing settings and saved reviews load with Archaic English 0; no database migration is needed.

The interface uses a dark, ivory-and-gold observation glyph, a compact PR queue, revision-aware inline findings, file/finding navigation, and reduced-motion support. On mobile, review controls collapse so the diff remains close to the PR metadata. The Python import package and `PRICK_*` environment names stay compatible with existing setup commands.

## Practical limits

This is a personal/internal tool: run **one worker** on localhost. For access from other machines, put it behind your own authenticated reverse proxy, configure forwarding appropriately, and add explicit comma-separated hostnames to `PRICK_ALLOWED_HOSTS`. The app has CSRF/origin checks, escaped output, a restrictive CSP, and host validation, but does not implement user accounts.

Changed code is sent to your chosen AI provider. Review coverage is deliberately bounded: at most 500 changed entries, content from the first 100 files, UTF-8 text under 400 KB and 8,000 lines per file, and roughly 70,000 characters of numbered diff for analysis. Summaries sample roughly 8,000 characters. Binary, oversized, non-UTF-8, and partially covered files are identified in the UI. Counts cover retrieved text only when files are excluded. The model gets the diff and user-supplied repository instructions; this MVP does not clone/index the whole repository or fetch arbitrary dependencies. A clean review is not a correctness guarantee.

## Development and verification

```sh
uv sync --extra copilot
uv run pytest
uv run ruff check prick tests scripts
uv run ruff format --check prick tests scripts
uv build
```

The focused tests cover independent controls, tone/archaic isolation and identifier preservation, response parsing, exact path/side/range validation, prompt budgets, Azure response/rename/deletion/pagination mapping, provider HTTP payloads, SDK signatures, CSRF, credentials, preview changes, stale reviews, and interrupted/duplicate publishing.

For a real-browser check, run the app in demo mode, then `uv run python scripts/browser_smoke.py`. The script uses installed Microsoft Edge, generates a demo review, edits and approves it, simulates publishing, checks settings and a mobile viewport, and saves screenshots to ignored `artifacts/`. It updates only local demo data. To use Chromium instead, change its browser channel and run `uv run playwright install chromium`.

Verification in this workspace used the demo, mocked Azure/AI HTTP contracts, and the installed Copilot SDK. Authenticated calls to your Azure organization and paid AI generation still require your credentials and were not exercised.

The implementation was checked against Microsoft's [PR iteration changes](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1), [commit item content](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1), and [thread creation](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/create?view=azure-devops-rest-7.1) documentation; GitHub's [Copilot SDK quickstart](https://docs.github.com/en/copilot/get-started/sdk-quickstart); and OpenAI's [structured outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

HTMX 2.0.8 is bundled locally with its license in `prick/static/HTMX-LICENSE.txt`.
