import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
    fs: { allow: [".."] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
});
