import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "..", // VITE_* values live in the repo-root .env, next to the backend's
  server: {
    proxy: {
      "/api": process.env.API_URL ?? "http://localhost:8000",
    },
  },
});
