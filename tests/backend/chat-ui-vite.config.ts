import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import agents from "agents/vite";

// Same app UI, separate local storage and an explicit localhost-only provider.
export default defineConfig({
  plugins: [agents(), react(), cloudflare({ configPath: "tests/backend/fixtures/wrangler.jsonc", inspectorPort: false, persistState: { path: ".wrangler/chat-ui-test" } }), tailwindcss()],
  resolve: { alias: { "@": new URL("../../src", import.meta.url).pathname } },
});
