/**
 * Contrato de framing del WebSocket único por sesión de examen (ADR-003).
 * Todo mensaje WS lleva como primer byte un discriminador de tipo:
 *   0x00 -> mensaje de control (JSON UTF-8 tras el byte)
 *   0x01 -> fragmento binario de video (sub-fragmento <=64KB de un chunk .webm)
 */

export const WS_FRAME_TYPE = {
  CONTROL: 0x00,
  VIDEO_CHUNK: 0x01,
} as const;

export type WsFrameType = (typeof WS_FRAME_TYPE)[keyof typeof WS_FRAME_TYPE];

/** Tamaño máximo de sub-fragmento de video por mensaje WS (ADR-003). */
export const MAX_VIDEO_SUBFRAGMENT_BYTES = 64 * 1024;

/**
 * Tipos de mensaje de control (campo `type` del JSON tras el byte 0x00).
 * Cada uno corresponde a una fase o módulo del flujo operativo de 4 fases.
 */
export type ControlMessageType =
  | "auth" // Fase 1 - identificación de sesión ante el servidor
  | "fullscreen-ack" // Fase 1 - confirmación de entrada a fullscreen
  | "next-question-request" // Fase 2 - solicitud de siguiente reactivo
  | "next-question-response" // Fase 2 - entrega de reactivo (server-side truth)
  | "answer-submit" // Fase 2 - envío de respuesta del alumno
  | "heartbeat" // Fase 2 - latido de sesión activa
  | "infraction-alert" // Fase 3 - disparo de kill-switch
  | "session-terminated" // Fase 4 - confirmación de anulación por infracción
  | "exam-completed"; // Finalización exitosa (todas las preguntas respondidas o agotado su tiempo)

export interface ControlMessageBase {
  type: ControlMessageType;
  sessionId: string;
  timestamp: number;
}

export type ControlMessage =
  | (ControlMessageBase & { type: "auth"; studentId: string })
  | (ControlMessageBase & { type: "fullscreen-ack" })
  | (ControlMessageBase & { type: "next-question-request" })
  | (ControlMessageBase & {
      type: "next-question-response";
      questionId: string;
      questionIndex: number;
      totalQuestions: number;
      prompt: string;
      choices: readonly string[];
      secondsAllowed: number;
    })
  | (ControlMessageBase & {
      type: "answer-submit";
      questionId: string;
      selectedChoiceIndex: number;
    })
  | (ControlMessageBase & { type: "heartbeat" })
  | (ControlMessageBase & {
      type: "infraction-alert";
      reason: InfractionReasonCode;
      detail?: string;
    })
  | (ControlMessageBase & {
      type: "session-terminated";
      reason: InfractionReasonCode;
    })
  | (ControlMessageBase & {
      type: "exam-completed";
      correctAnswers: number;
      totalQuestions: number;
    });

/**
 * Códigos de motivo de infracción (ADR-006), compartidos entre cliente y servidor
 * para que el payload de `sendBeacon` (Fase 4) y los logs del servidor usen el mismo vocabulario.
 */
export type InfractionReasonCode =
  | "TAB_HIDDEN"
  | "WINDOW_BLUR"
  | "FULLSCREEN_EXIT"
  | "SCREEN_SHARE_ENDED"
  | "CAMERA_OR_MIC_ENDED"
  | "DISPLAY_SURFACE_NOT_MONITOR"
  | "MULTIPLE_MONITORS_DETECTED"
  | "VIRTUAL_CAMERA_DETECTED"
  | "FACE_ABSENT"
  | "MULTIPLE_FACES_DETECTED"
  | "HEAD_POSE_DEVIATION"
  | "PROHIBITED_OBJECT_DETECTED"
  | "DEVTOOLS_SHORTCUT_BLOCKED"
  | "TIMER_EXPIRED"
  | "ADMIN_CANCELLED";

/** Decodifica el byte de tipo de un mensaje WS entrante. */
export function readFrameType(data: ArrayBuffer | Uint8Array): WsFrameType {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const first = bytes[0];
  if (first !== WS_FRAME_TYPE.CONTROL && first !== WS_FRAME_TYPE.VIDEO_CHUNK) {
    throw new Error(`Byte de framing WS desconocido: 0x${(first ?? 0).toString(16)}`);
  }
  return first;
}

/** Construye un frame de control: byte 0x00 + JSON UTF-8. */
export function encodeControlFrame(message: ControlMessage): Uint8Array {
  const json = JSON.stringify(message);
  const jsonBytes = new TextEncoder().encode(json);
  const frame = new Uint8Array(1 + jsonBytes.length);
  frame[0] = WS_FRAME_TYPE.CONTROL;
  frame.set(jsonBytes, 1);
  return frame;
}

/** Decodifica un frame de control (asume que el byte 0 ya fue validado como CONTROL). */
export function decodeControlFrame(data: ArrayBuffer | Uint8Array): ControlMessage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const json = new TextDecoder().decode(bytes.subarray(1));
  return JSON.parse(json) as ControlMessage;
}

/** Construye un frame de video: byte 0x01 + sub-fragmento binario (<=64KB). */
export function encodeVideoFrame(chunk: Uint8Array): Uint8Array {
  if (chunk.byteLength > MAX_VIDEO_SUBFRAGMENT_BYTES) {
    throw new Error(
      `Sub-fragmento de video excede el máximo permitido (${MAX_VIDEO_SUBFRAGMENT_BYTES} bytes)`,
    );
  }
  const frame = new Uint8Array(1 + chunk.byteLength);
  frame[0] = WS_FRAME_TYPE.VIDEO_CHUNK;
  frame.set(chunk, 1);
  return frame;
}

/** Extrae el payload binario de un frame de video (asume byte 0 ya validado como VIDEO_CHUNK). */
export function decodeVideoFrame(data: ArrayBuffer | Uint8Array): Uint8Array {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.subarray(1);
}
