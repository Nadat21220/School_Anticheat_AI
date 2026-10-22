/**
 * Contratos de estado de sesión de examen (ADR-004: server-side truth en memoria).
 */

import type { InfractionReasonCode } from "./ws-protocol.js";

export interface QuestionRecord {
  id: string;
  prompt: string;
  /** Texto de cada inciso en su orden ORIGINAL (el servidor aleatoriza por sesión, ver `choiceOrder`). */
  choices: readonly string[];
  correctChoiceIndex: number;
  secondsAllowed: number;
}

/** Orden aleatorizado de índices de incisos, único por sesión y por pregunta. */
export type ChoiceOrder = readonly number[];

export interface AnswerRecord {
  questionId: string;
  selectedChoiceIndex: number;
  correct: boolean;
  answeredAtMs: number;
}

export type SessionStatus = "lobby" | "in-progress" | "terminated-by-infraction" | "completed";

/**
 * Estado de una sesión de examen, mantenido en memoria por el backend (ADR-004).
 * El servidor es la única fuente de verdad: el tiempo restante se calcula siempre
 * comparando `Date.now()` contra `currentQuestionStartedAtMs`, nunca se acepta
 * un valor de tiempo enviado por el cliente.
 */
export interface SessionState {
  sessionId: string;
  studentId: string;
  status: SessionStatus;
  /** Orden aleatorizado (una sola vez, al iniciar) de los IDs de pregunta a entregar. */
  questionOrder: readonly string[];
  /** Orden de incisos por pregunta, generado una sola vez al iniciar. */
  choiceOrderByQuestionId: Readonly<Record<string, ChoiceOrder>>;
  currentQuestionIndex: number;
  currentQuestionStartedAtMs: number | null;
  answers: readonly AnswerRecord[];
  terminationReason: InfractionReasonCode | null;
  createdAtMs: number;
  lastCheckpointAtMs: number;
}

/** Checkpoint persistido a disco/DB en cada transición de pregunta (ADR-004). */
export interface SessionCheckpoint {
  sessionId: string;
  state: SessionState;
  persistedAtMs: number;
}
