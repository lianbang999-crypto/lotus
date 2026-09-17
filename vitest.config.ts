import { defineConfig } from "vitest/config";

// Unit tests do not start the Cloudflare Vite plugin or a Worker inspector.
// `@` 要和 vite.config.ts / tsconfig 保持一致：shadcn 体系的组件都按 `@/lib/utils` 引 cn，
// 测试里少了这条别名，只要某个被测模块间接 import 到组件，整个测试文件就会加载失败。
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
