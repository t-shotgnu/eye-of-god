import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(frontend, "..");
const artifacts = join(root, "artifacts");
const screenshots = join(root, "docs", "screenshots");
await mkdir(artifacts, { recursive: true });
await mkdir(screenshots, { recursive: true });
const data = await mkdtemp(join(artifacts, "readme-screenshots-"));
const servers = [];
let browser;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return port;
}

function start(command, args, cwd, env) {
  const process = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const server = { process, output: "", error: null };
  process.on("error", (error) => {
    server.error = error;
  });
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("data", (chunk) => {
      server.output = (server.output + chunk).slice(-6000);
    });
  }
  servers.push(server);
  return server;
}

async function ready(server, url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server.error) throw server.error;
    if (server.process.exitCode !== null)
      throw new Error(`Screenshot server exited.\n${server.output}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* The server is still starting. */
    }
    await new Promise((accept) => setTimeout(accept, 200));
  }
  throw new Error(`Screenshot server did not start.\n${server.output}`);
}

async function capture(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
    if (!document.fonts.check('400 16px "Cinzel Decorative"'))
      throw new Error("Heading font failed to load.");
  });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: join(screenshots, name),
    fullPage: true,
    animations: "disabled",
  });
  console.log(`Saved docs/screenshots/${name}`);
}

try {
  // Use a fresh demo workspace and exclude user configuration from both servers.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("PRICK_")),
  );
  const apiPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const api = start(
    "dotnet",
    [
      join(
        root,
        "backend",
        "EyeOfGod.Api",
        "bin",
        "Debug",
        "net10.0",
        "EyeOfGod.Api.dll",
      ),
      "--urls",
      apiUrl,
    ],
    join(root, "backend", "EyeOfGod.Api"),
    { ...env, PRICK_DATA_DIR: data },
  );
  await ready(api, `${apiUrl}/health`);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const preview = start(
    process.execPath,
    [
      join(frontend, "node_modules", "vite", "bin", "vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    frontend,
    { ...env, PRICK_API_URL: apiUrl },
  );
  await ready(preview, url);

  browser = await chromium.launch({ channel: "msedge" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const session = await (
    await context.request.get(`${url}/api/session`)
  ).json();
  if (!session.configuration.settings.demo)
    throw new Error("Screenshots require the isolated demo workspace.");

  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".summary-tags").nth(2).waitFor();
  await capture(page, "dashboard.png");

  await page
    .getByRole("link", { name: "Add backoff to failed delivery retries" })
    .click();
  await page.getByRole("button", { name: "Seek judgement" }).click();
  await page.locator(".finding").first().waitFor();
  await page
    .locator(".finding")
    .first()
    .getByRole("button", { name: "Approve comment" })
    .click();
  await page.getByText("Comment approved.", { exact: true }).waitFor();
  // Reload to show the saved review without a transient action notice.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".finding").first().waitFor();
  await capture(page, "review.png");

  await page.goto(`${url}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Settings." }).waitFor();
  await capture(page, "settings.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/prs/142`, { waitUntil: "networkidle" });
  await page.locator(".finding").first().waitFor();
  await capture(page, "mobile-review.png");
} finally {
  await browser?.close();
  for (const { process } of servers.reverse()) {
    if (process.exitCode === null && process.pid) {
      const closed = once(process, "close");
      process.kill();
      await closed;
    }
  }
  // Only delete the generated workspace within the known artifacts directory.
  const target = relative(artifacts, data);
  if (
    isAbsolute(target) ||
    target.startsWith("..") ||
    !target.startsWith("readme-screenshots-")
  ) {
    throw new Error("Screenshot workspace is outside the expected directory.");
  }
  await rm(data, { recursive: true, force: true });
}
