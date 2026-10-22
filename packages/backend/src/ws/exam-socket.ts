import type { FastifyInstance } from "fastify";
import {
  WS_FRAME_TYPE,
  readFrameType,
  decodeControlFrame,
  decodeVideoFrame,
  type ControlMessage,
} from "@proctoring/shared";
import { sessionRecorder } from "../ingest/session-recorder.js";
import { liveBroadcast } from "../ingest/live-broadcast.js";
import { questionFlowEngine } from "../exam-engine/question-flow.js";

/**
 * Ruta WS única por sesión de examen (ADR-002/ADR-003): demultiplexa por el
 * byte de tipo de cada frame y rutea a: (a) el motor de entrega de preguntas
 * (exam-engine/question-flow.ts, ADR-004/010/011/012), o (b) ingesta de
 * evidencia de video (ADR-002).
 */
export async function registerExamWebSocketRoute(app: FastifyInstance): Promise<void> {
  app.get("/ws/exam", { websocket: true }, (socket) => {
    let sessionId: string | null = null;

    socket.on("message", (raw: Buffer) => {
      const bytes = new Uint8Array(raw);
      const frameType = readFrameType(bytes);

      if (frameType === WS_FRAME_TYPE.CONTROL) {
        const message = decodeControlFrame(bytes);
        handleControlMessage(message, socket);
        if (message.type === "auth") {
          sessionId = message.sessionId;
        }
        return;
      }

      // frameType === WS_FRAME_TYPE.VIDEO_CHUNK
      if (!sessionId) {
        app.log.warn("Fragmento de video recibido antes de autenticar la sesión; descartado.");
        return;
      }
      const videoChunk = decodeVideoFrame(bytes);
      sessionRecorder.append(sessionId, videoChunk);
      liveBroadcast.publish(sessionId, videoChunk);
    });

    socket.on("close", () => {
      if (sessionId) {
        sessionRecorder.close(sessionId);
        questionFlowEngine.unregisterChannel(sessionId);
      }
    });
  });

  function handleControlMessage(
    message: ControlMessage,
    socket: { send: (data: Uint8Array) => void },
  ): void {
    switch (message.type) {
      case "auth": {
        questionFlowEngine.registerChannel(message.sessionId, (frame) => socket.send(frame));
        questionFlowEngine.startExam(message.sessionId, message.studentId);
        break;
      }
      case "next-question-request": {
        questionFlowEngine.requestFirstQuestion(message.sessionId);
        break;
      }
      case "answer-submit": {
        questionFlowEngine.submitAnswer(
          message.sessionId,
          message.questionId,
          message.selectedChoiceIndex,
        );
        break;
      }
      case "infraction-alert": {
        questionFlowEngine.terminateSession(message.sessionId, message.reason);
        break;
      }
      case "heartbeat":
      case "fullscreen-ack":
      case "next-question-response":
      case "session-terminated":
      case "exam-completed":
        break;
    }
  }
}
