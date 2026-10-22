import { defineConfig } from "vite";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3987";
const BACKEND_WS_URL = BACKEND_URL.replace(/^http/, "ws");

export default defineConfig({
  server: {
    host: true,
    proxy: {
      "/ws/exam": { target: BACKEND_WS_URL, ws: true },
      "/ws/admin": { target: BACKEND_WS_URL, ws: true },
      "/api": { target: BACKEND_URL },
      "/health": { target: BACKEND_URL },
      "/evidence": { target: BACKEND_URL },
    },
  },
  preview: {
    host: true,
    proxy: {
      "/ws/exam": { target: BACKEND_WS_URL, ws: true },
      "/ws/admin": { target: BACKEND_WS_URL, ws: true },
      "/api": { target: BACKEND_URL },
      "/health": { target: BACKEND_URL },
      "/evidence": { target: BACKEND_URL },
    },
  },
});
