import type { FastifyInstance } from "fastify";
import { liveBroadcast } from "../ingest/live-broadcast.js";

/**
 * WS de solo lectura para el panel de admin: transmite en vivo los mismos
 * chunks de video que el alumno está enviando (fan-out desde liveBroadcast).
 */
export async function registerAdminLiveSocketRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sessionId?: string } }>(
    "/ws/admin/live",
    { websocket: true },
    (socket, request) => {
      const sessionId = request.query.sessionId;
      if (!sessionId) {
        socket.close();
        return;
      }

      const unsubscribe = liveBroadcast.subscribe(sessionId, (chunk) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(chunk);
        }
      });

      socket.on("close", () => unsubscribe());
    },
  );
}
