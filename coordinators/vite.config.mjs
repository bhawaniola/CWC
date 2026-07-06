import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
