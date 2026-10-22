import type { FastifyInstance } from "fastify";
import { sessionRegistry } from "../exam-engine/session-registry.js";
import { questionFlowEngine } from "../exam-engine/question-flow.js";

/**
 * Panel de administrador (sencillo): lista de sesiones activas para que el
 * supervisor pueda ver qué alumno está presentando el examen y abrir su
 * grabación de evidencia.
 */
export async function registerAdminSessionsRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/sessions", async () => {
    return sessionRegistry.list().map((state) => ({
      sessionId: state.sessionId,
      studentId: state.studentId,
      status: state.status,
      currentQuestionIndex: state.currentQuestionIndex,
      totalQuestions: state.questionOrder.length,
      terminationReason: state.terminationReason,
      createdAtMs: state.createdAtMs,
      lastCheckpointAtMs: state.lastCheckpointAtMs,
    }));
  });

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/cancel",
    async (request, reply) => {
      questionFlowEngine.terminateSession(request.params.sessionId, "ADMIN_CANCELLED");
      await reply.code(204).send();
    },
  );
}
