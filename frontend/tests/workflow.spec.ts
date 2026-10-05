import { test, expect } from "@playwright/test";

test("shared layouts fit desktop and mobile viewports", async ({ page }) => {
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/prs/142", "/settings", "/sandbox"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        `${path} overflows at ${width}px`,
      ).toBe(false);
    }
  }
  await page.screenshot({
    path: "../artifacts/shadcn-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.screenshot({
    path: "../artifacts/shadcn-mobile.png",
    fullPage: true,
  });
});

test("shared controls support keyboard interaction and accessible labels", async ({
  page,
}) => {
  await page.goto("/settings");
  const provider = page.getByRole("combobox", {
    name: "Provider",
    exact: true,
  });
  await provider.focus();
  await provider.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: "OpenAI-compatible / local" }).focus();
  await page.keyboard.press("Enter");
  await expect(provider).toContainText("OpenAI-compatible / local");
  const profanity = page.getByRole("switch", {
    name: "Allow profanity at aggressive tones",
  });
  const initial = await profanity.getAttribute("aria-checked");
  await profanity.focus();
  await profanity.press("Space");
  await expect(profanity).toHaveAttribute(
    "aria-checked",
    initial === "true" ? "false" : "true",
  );
  await page.goto("/sandbox");
  const files = page.getByRole("tab", { name: /^Files/ });
  await files.focus();
  await files.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Findings/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: /^Findings/ })).toBeVisible();
  await expect(
    page
      .getByRole("tabpanel")
      .getByRole("navigation", { name: "Review findings" }),
  ).toBeVisible();
  const disclosure = page
    .locator(".file-diff")
    .first()
    .getByRole("button")
    .first();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh pull requests" }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Refresh pull requests",
  );
});

test("review, edit, approve, preview and simulated publishing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Pull requests." }),
  ).toBeVisible();
  await expect(page.locator(".pr-entry")).toHaveCount(3);
  await expect(page.locator(".summary-tags")).toHaveCount(3);
  expect(
    await page
      .locator(".brand img")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/react-dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Add backoff to failed delivery retries" })
    .click();
  const tone = page.getByRole("slider", { name: "Tone", exact: true });
  await tone.focus();
  await tone.press("End");
  await tone.press("ArrowLeft");
  await tone.press("ArrowLeft");
  const archaic = page.getByRole("slider", {
    name: "Archaic English",
    exact: true,
  });
  await archaic.focus();
  await archaic.press("End");
  await archaic.press("ArrowLeft");
  await archaic.press("ArrowLeft");
  await archaic.press("ArrowLeft");
  await page.getByRole("button", { name: "Seek judgement" }).click();
  await expect(page.locator(".finding").first()).toBeVisible();
  await expect(page.locator(".inline-finding").first()).toBeVisible();
  const finding = page.locator(".finding").first();
  await finding
    .getByLabel("Edit comment")
    .fill(
      "[warning] Browser-verified edited comment. Guard the exhausted retry budget before division.",
    );
  await finding.getByRole("button", { name: "Approve comment" }).click();
  await expect(finding.locator(".decision")).toHaveText("approved");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../artifacts/react-review.png",
    fullPage: true,
  });
  await finding.getByRole("link", { name: "Publish this" }).click();
  await expect(
    page.getByRole("heading", { name: "Publishing preview" }),
  ).toBeVisible();
  await expect(page.locator(".publish-comment")).toContainText(
    "Browser-verified edited comment.",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator(".published").first()).toContainText(
    "Simulated publish",
  );
  expect(errors).toEqual([]);
});

test("settings, deep links, sandbox and responsive layouts", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings." })).toBeVisible();
  await page
    .getByLabel("Repository review instructions")
    .fill("HTTP calls must have timeouts.");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText(
    "Settings saved.",
  );
  await page.reload();
  await expect(page.getByLabel("Repository review instructions")).toHaveValue(
    "HTTP calls must have timeouts.",
  );
  await page.goto("/sandbox");
  await expect(page.locator(".file-diff")).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Publish approved" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "../artifacts/react-sandbox.png",
    fullPage: true,
  });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/prs/142", "/settings", "/sandbox"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${path} overflows at ${width}px`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prs/142");
  await expect(page.locator(".diff-table")).toBeVisible();
  await page.screenshot({
    path: "../artifacts/react-mobile.png",
    fullPage: true,
  });
});
