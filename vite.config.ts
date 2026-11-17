import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Relative base: the site works from any GitHub Pages path without knowing the repo name.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  // The release version and, on CI, the commit the page was built from.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? "").slice(0, 7)),
  },
  plugins: [react()],
  test: { environment: "node" },
});
