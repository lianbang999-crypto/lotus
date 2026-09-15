import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare({ configPath: "tests/backend/fixtures/wrangler.jsonc", inspectorPort: false, persistState: { path: ".wrangler/chat-wire-test" } })],
});
