import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import agents from "agents/vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare({ inspectorPort: false }), tailwindcss(), {
    name: "lotus-exclude-local-secrets",
    enforce: "post",
    generateBundle(_, bundle) {
      // Cloudflare emits local vars for `vite preview`; release artifacts must
      // instead use Worker Secrets. Keep local credentials out of every bundle.
      for (const file of Object.keys(bundle)) if (file === ".dev.vars" || file.startsWith(".dev.vars.")) delete bundle[file];
    },
  }],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } }
});
