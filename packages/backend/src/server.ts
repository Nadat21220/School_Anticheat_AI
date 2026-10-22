import { join } from "node:path";
import { mkdirSync } from "node:fs";
import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { registerExamWebSocketRoute } from "./ws/exam-socket.js";
import { registerAdminLiveSocketRoute } from "./ws/admin-live-socket.js";
import { registerInfractionBeaconRoute } from "./routes/infraction-beacon.js";
import { registerAdminSessionsRoute } from "./routes/admin-sessions.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? join(process.cwd(), "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const app = Fastify({
  logger: true,
});

await app.register(websocketPlugin, {
  options: {
    maxPayload: 1024 * 1024, // 1MB por mensaje WS (framing ADR-003 trocea video a <=64KB)
  },
});

await app.register(staticPlugin, {
  root: EVIDENCE_DIR,
  prefix: "/evidence/",
  decorateReply: false,
});

app.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));

await registerExamWebSocketRoute(app);
await registerAdminLiveSocketRoute(app);
await registerInfractionBeaconRoute(app);
await registerAdminSessionsRoute(app);

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
