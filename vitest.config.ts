import { defineConfig } from "vitest/config";

// Unit tests do not start the Cloudflare Vite plugin or a Worker inspector.
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
