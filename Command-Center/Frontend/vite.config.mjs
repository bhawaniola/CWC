import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  publicDir: "public",
  plugins: [react()],
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
