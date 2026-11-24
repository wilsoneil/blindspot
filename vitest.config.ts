import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same "@/..." shortcut for src/ that the app uses (tsconfig.json "paths").
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
