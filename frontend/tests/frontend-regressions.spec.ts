import { test, expect, type Page, type Route } from "@playwright/test";
import type { Configuration, Detail, Review } from "../src/types";

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function demoDetail(page: Page, id: number): Promise<Detail> {
  const response = await page.request.get(`/api/prs/${id}`);
  expect(response.ok()).toBe(true);
  return { ...(await response.json()), reviews: [] };
}

test("failed loads can retry and filtering handles whitespace", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(/\/api\/prs$/, async (route) => {
    if (attempts++ === 0) {
      await route.fulfill({ status: 503, json: null });
    } else {
      await route.continue();
    }
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Request failed (HTTP 503).",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".pr-entry")).toHaveCount(3);
  await page
    .getByRole("textbox", { name: "Filter pull requests" })
    .fill("  MAYA  ");
  await expect(page.locator(".pr-entry")).toHaveCount(1);
  await expect(page.locator(".pr-entry")).toContainText("Maya Chen");
  await page
    .getByRole("textbox", { name: "Filter pull requests" })
    .fill("no-such-pr");
  await expect(page.getByText("No matching pull requests.")).toBeVisible();
});

test("PR navigation isolates controls and a pending review result", async ({
  page,
}) => {
  const first = await demoDetail(page, 142);
  const second = await demoDetail(page, 139);
  const session: { configuration: Configuration } = await (
    await page.request.get("/api/session")
  ).json();
  await page.route(/\/api\/prs\/142$/, (route) =>
    route.fulfill({ json: first }),
  );
  await page.route(/\/api\/prs\/139$/, (route) =>
    route.fulfill({ json: second }),
  );
  let pending: Route | undefined;
  await page.route(/\/api\/prs\/142\/review$/, (route) => {
    pending = route;
  });

  await page.goto("/prs/142");
  const tone = page.getByRole("slider", { name: "Tone", exact: true });
  await tone.focus();
  await tone.press(
    session.configuration.settings.defaults.tone === 10 ? "Home" : "End",
  );
  await page.getByLabel("Model for this review").fill("first-pr-model");
  await page.getByRole("button", { name: "Seek judgement" }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByLabel("Model for this review")).toBeDisabled();

  await navigateInApp(page, "/prs/139");
  await expect(
    page.getByRole("heading", { name: second.pr.title }),
  ).toBeVisible();
  await expect(tone).toHaveAttribute(
    "aria-valuenow",
    String(session.configuration.settings.defaults.tone),
  );
  await expect(page.getByLabel("Model for this review")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Seek judgement" }),
  ).toBeEnabled();

  const lateReview: Review = {
    id: "late-first-pr-review",
    scope: "demo",
    pr_id: 142,
    created: "2026-10-05T12:00:00Z",
    options: session.configuration.settings.defaults,
    provider: "demo",
    model: "first-pr-model",
    changes: first.changes,
    overview: "This result belongs to the first PR.",
    findings: [],
    warnings: [],
  };
  const delivered = page.waitForResponse(/\/api\/prs\/142\/review$/);
  await pending!.fulfill({ json: lateReview });
  await (await delivered).finished();
  // A rendering boundary after delivery catches accidental state updates to the current PR.
  await page
    .getByRole("slider", { name: "Thoroughness", exact: true })
    .press("ArrowRight");
  await expect(page.getByText("Awaiting judgement")).toBeVisible();
  await expect(page.getByText(lateReview.overview)).toHaveCount(0);
});

test("changing provider cancels an obsolete model catalog", async ({
  page,
}) => {
  let pending: Route | undefined;
  let requests = 0;
  await page.route("**/api/settings/ai/models", async (route) => {
    if (requests++ === 0) {
      pending = route;
    } else {
      await route.fulfill({
        json: { models: ["current-model"], message: "Current catalog." },
      });
    }
  });
  await page.goto("/settings");
  const check = page.getByRole("button", {
    name: "Check connection & refresh models",
  });
  await check.click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(check).toBeDisabled();
  await page.getByRole("combobox", { name: "Provider", exact: true }).click();
  const cancelled = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/settings/ai/models"),
  });
  await page.getByRole("option", { name: "OpenAI-compatible / local" }).click();
  expect((await cancelled).failure()?.errorText).toContain("ERR_ABORTED");
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByText("Current catalog.")).toBeVisible();
  await pending!.fulfill({
    json: { models: ["obsolete-model"], message: "Obsolete catalog." },
  });
  await page.getByLabel("Model ID", { exact: true }).fill("current-model");
  await expect(page.locator("#available-models option")).toHaveAttribute(
    "value",
    "current-model",
  );
  await expect(page.getByText("Obsolete catalog.")).toHaveCount(0);
});

test("viewing a finding reopens its file and highlights its line", async ({
  page,
}) => {
  const detail = await demoDetail(page, 142);
  const session: { configuration: Configuration } = await (
    await page.request.get("/api/session")
  ).json();
  const file = detail.changes.files[0];
  const line = file.lines.find(
    (item) => item.kind === "add" && item.new !== null,
  )!;
  const review: Review = {
    id: "diff-navigation-review",
    scope: "demo",
    pr_id: 142,
    created: "2026-10-05T12:00:00Z",
    options: session.configuration.settings.defaults,
    provider: "demo",
    model: "demo",
    changes: detail.changes,
    overview: "Diff navigation fixture.",
    warnings: [],
    findings: [
      {
        id: "navigation-finding",
        comment: "Inspect this changed line.",
        decision: "draft",
        publish_state: "unpublished",
        thread_id: null,
        finding: {
          file: file.path,
          side: "right",
          line_start: line.new!,
          line_end: line.new!,
          severity: "warning",
          category: "correctness",
          explanation: "Inspect the added code.",
          suggested_change: null,
        },
      },
    ],
  };
  await page.route(/\/api\/prs\/142$/, (route) =>
    route.fulfill({ json: { ...detail, reviews: [review] } }),
  );
  await page.goto("/prs/142");
  const disclosure = page
    .locator(".file-diff")
    .first()
    .getByRole("button")
    .first();
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "View in diff" }).click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator(`.file-diff tr[data-new="${line.new}"]`),
  ).toHaveClass(/highlight/);
});
