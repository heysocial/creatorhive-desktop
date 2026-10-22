import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The interface is loaded from disk (file://), so every asset path is relative.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome140",
    sourcemap: false,
  },
});
