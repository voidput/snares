import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Relative base: the site works from any GitHub Pages path without knowing the repo name.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "node" },
});
