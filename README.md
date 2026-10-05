# Eye of God

A self-hosted AI code reviewer for Azure DevOps Services / Azure Repos Git. ASP.NET Core (.NET 10) provides the JSON API, SQLite persistence and provider adapters. React 19, TypeScript and Vite provide the interface. The production frontend is served by the same .NET process.

## Run

Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and [Node.js](https://nodejs.org/) 22.12+ (or 20.19+).

```sh
npm run setup
npm run build
npm start
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The default demo has three PRs and simulated review/publishing. It needs no credentials or paid AI calls. Its findings are deterministic examples.

For frontend development, start the API with `npm start` and run `npm --prefix frontend run dev` in another terminal. Vite proxies `/api` and `/health` to the API. Open the URL printed by Vite. Rebuild the frontend to update the version served directly by .NET.

## Configure

In Settings, disable the demo and enter the Azure organization **name**, project, repository name or ID, and PAT. Reading needs code read access; posting review threads needs the relevant code/review thread write permission. The adapter uses REST API 7.1, immutable commit content, and PR iteration change tracking. Azure DevOps Server/custom hosts and PRs without iterations are unsupported.

| Provider | Configuration |
| --- | --- |
| OpenAI | API key and a model available to your account; Chat Completions with structured output. |
| OpenAI-compatible / local | Base URL including `/v1`, model ID, optional key. JSON object and prompt-only modes support servers without JSON Schema. |
| GitHub Copilot | Official `GitHub.Copilot.SDK` .NET package, Copilot access, CLI login or supported GitHub token. Empty model uses `auto`. |

Copilot's official SDK downloads its bundled CLI during the first build. `COPILOT_CLI_PATH` can select an external compatible executable. Sessions use an isolated working directory, disable tools, config discovery and skills, and deny permissions. See the [official SDK](https://github.com/github/copilot-sdk/tree/main/dotnet) and [authentication setup](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/local-cli).

**Check connection & refresh models** checks the entered provider/key, including unsaved edits. It fetches `/models`, makes no completion, and saves nothing. Catalogs are cached for five minutes by provider/endpoint/credential. Each PR and sandbox review may override the default model; its selection is saved with the review.

## Review

1. Open a PR and inspect its summary and numbered diff.
2. Choose independent Thoroughness, Nitpicking, Conventions and Tone values (1-10), plus Archaic English (0-10).
3. Choose **Seek judgement**. Detection sees only the first three controls and repository instructions. A separate presentation call applies tone and archaic language to validated findings.
4. Edit findings, save drafts, dismiss or explicitly approve comments. Approval saves the text locally.
5. Open **Publish this** or **Publish approved**, inspect the saved text, then press **Publish**.

The React interface includes file/finding navigation, inline diff findings, review history, revision warnings, connection checks, and responsive controls. Mobile review controls start collapsed. Every neutral finding and suggested change remains available for comparison with styled comments. Archaic English 10 requests dense medieval pastiche; identifiers and code remain verbatim.

Publishing checks the exact preview, repository/PR scope, source/target/base revisions, iteration, active status and changed-line locations. Results are persisted after each comment. A timeout or process interruption can leave a remote outcome unknown: such comments become **uncertain**, and reposting is blocked. Check Azure manually. Successful earlier posts remain recorded. There is no automatic retry of comment creation and Azure has no atomic batch revision precondition here.

## Sandbox

Open `/sandbox` for an inert Python diff about downloads and retry pacing. Opening the page makes no AI calls. **Seek judgement** invokes the configured real provider even when demo mode is enabled. Azure credentials are unnecessary. Reviews persist under a separate local scope; approval and publishing are unavailable. Sample code is never executed.

## Data And Environment

Existing Python-version `.data/settings.json` and `.data/reviews.sqlite3` load directly: JSON property names, SQLite tables, review IDs and repository scopes are preserved. Missing Archaic English values default to zero. No data conversion or Python runtime is needed. `PRICK_DATA_DIR` selects another data directory. In this repository, the default remains the root `.data`; outside the repository, it is `.data` beneath the server's content root.

Blank credential fields retain saved credentials; clear checkboxes remove them. API responses contain only configured/not-configured flags. The settings file contains plaintext credentials, so protect it using normal OS permissions. Environment-supplied credentials are never copied to disk.

Existing `PRICK_*` variables override settings: `PRICK_DEMO`, `PRICK_AZURE_ORGANIZATION`, `PRICK_AZURE_PROJECT`, `PRICK_AZURE_REPOSITORY`, `PRICK_AZURE_PAT`, `PRICK_PROVIDER`, `PRICK_MODEL`, `PRICK_API_KEY`, `PRICK_API_BASE`, and `PRICK_COPILOT_TOKEN`. `.env.example` lists them; `.env` files are not automatically loaded. Environment-managed fields are disabled in the UI.

Run one instance on localhost. For remote access, use an authenticated reverse proxy. The app has no user accounts.

Changed code is sent to the selected AI provider. Coverage is bounded to 500 changed entries, content from the first 100 files, UTF-8 files under 400 KB and 8,000 lines, and about 70,000 characters of numbered diff. Summaries sample about 8,000 characters. Exclusions and partial coverage are displayed. Findings must cite exact supplied paths, visible old/new ranges and at least one changed line. Output schemas are validated locally in every provider mode. Presentation output must preserve finding identities and protected identifiers/code; failures retain neutral wording. Human review is still needed.

## Verify And Publish

```sh
npm run build
npm test
npm run test:browser
npm run publish
```

The .NET tests cover review controls, response schemas, identifiers, diff budgets, Azure contracts, credentials, CSRF, changed previews, stale revisions, sandbox isolation and interrupted/partial publishing. Playwright builds and serves the frontend through Vite preview, proxies to an isolated demo API, and uses installed Microsoft Edge with desktop/mobile viewports. Browser data lives in `artifacts/browser-data`; screenshots are saved in `artifacts/`. Frontend regressions cover retries, PR state isolation, model lookup cancellation and diff navigation. To use another browser, change `frontend/playwright.config.ts` and install its Playwright browser.

`npm run publish` builds React and creates a framework-dependent distribution in `artifacts/publish`. Run `dotnet artifacts/publish/EyeOfGod.Api.dll --urls http://127.0.0.1:8000` on a machine with the .NET 10 ASP.NET Core runtime. The output includes the React assets and Copilot CLI.

Authenticated Azure/AI calls require your credentials. Automated verification uses demo data and mocked HTTP contracts; it does not spend inference quota or post to a real repository.
