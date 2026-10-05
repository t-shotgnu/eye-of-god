import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const apiTarget = process.env.PRICK_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, request) => {
            // Preserve same-origin validation when forwarding local Vite requests.
            if (
              request.headers.origin &&
              URL.canParse(request.headers.origin) &&
              new URL(request.headers.origin).host === request.headers.host
            ) {
              proxyReq.setHeader("Origin", apiTarget);
            }
          });
        },
      },
      "/health": apiTarget,
    },
  },
});
