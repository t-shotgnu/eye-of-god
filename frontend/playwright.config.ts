import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.PRICK_BROWSER_URL ?? "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: process.env.PRICK_BROWSER_URL
    ? undefined
    : [
        {
          command:
            "dotnet run --project ../backend/EyeOfGod.Api --no-restore --urls http://127.0.0.1:8001",
          url: "http://127.0.0.1:8001/health",
          reuseExistingServer: false,
          env: {
            PRICK_DATA_DIR: resolve("../artifacts/browser-data"),
            PRICK_DEMO: "true",
          },
          timeout: 60000,
        },
        {
          command: "vite preview --host 127.0.0.1 --port 4173 --strictPort",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: false,
          env: { PRICK_API_URL: "http://127.0.0.1:8001" },
          timeout: 30000,
        },
      ],
});
