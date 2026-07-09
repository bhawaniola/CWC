import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      "/api": "http://localhost:9400",
      "/socket.io": {
        target: "http://localhost:9400",
        ws: true
      }
    }
  }
});
