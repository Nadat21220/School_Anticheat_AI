import type { FastifyInstance } from "fastify";
import type { InfractionReasonCode } from "@proctoring/shared";
import { questionFlowEngine } from "../exam-engine/question-flow.js";

interface InfractionBeaconBody {
  sessionId: string;
  reason: InfractionReasonCode;
  timestamp: number;
}

/**
 * Respaldo de Fase 4 (sendBeacon): garantiza la anulación de la sesión
 * incluso si el WebSocket ya se cerró por el cierre abrupto de la pestaña.
 */
export async function registerInfractionBeaconRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: InfractionBeaconBody }>("/api/infraction-beacon", async (request, reply) => {
    const { sessionId, reason } = request.body;
    questionFlowEngine.terminateSession(sessionId, reason);
    await reply.code(204).send();
  });
}
