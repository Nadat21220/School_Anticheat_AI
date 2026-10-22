import { randomInt } from "node:crypto";
import {
  encodeControlFrame,
  type ChoiceOrder,
  type ControlMessage,
  type InfractionReasonCode,
  type SessionState,
} from "@proctoring/shared";
import { sessionRegistry } from "./session-registry.js";
import { persistCheckpoint } from "./checkpoint-store.js";
import { loadQuestionBank, type QuestionBank } from "./question-bank.js";

/**
 * Motor de entrega secuencial de preguntas (ADR-004, ADR-010, ADR-011, ADR-012).
 * Server-side truth: aleatorización de preguntas/incisos única por sesión,
 * temporizador de 45s por reactivo con cumplimiento híbrido (timer proactivo
 * + validación perezosa de doble chequeo), sin retroceso.
 */

type DeliveryChannel = (frame: Uint8Array) => void;

/** Fisher-Yates con `crypto.randomInt` (aleatorización criptográficamente segura). */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

export class QuestionFlowEngine {
  private readonly channels = new Map<string, DeliveryChannel>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly bank: QuestionBank) {}

  /** Registra el canal de envío WS de una sesión (ADR-003: frame de control). */
  registerChannel(sessionId: string, send: DeliveryChannel): void {
    this.channels.set(sessionId, send);
  }

  /** Libera el canal y cualquier timer activo al cerrarse la conexión. */
  unregisterChannel(sessionId: string): void {
    this.channels.delete(sessionId);
    this.clearTimer(sessionId);
  }

  /** Fase 1→2: crea la sesión con orden de preguntas/incisos aleatorizado una sola vez. */
  startExam(sessionId: string, studentId: string): SessionState {
    const existing = sessionRegistry.get(sessionId);
    if (existing && existing.status !== "lobby") {
      // 'auth' repetido (ej. reconexión que reenvía un mensaje en vuelo): no
      // reiniciar una sesión que ya está en progreso o finalizada.
      return existing;
    }

    sessionRegistry.create(sessionId, studentId);

    const questionOrder = shuffle(this.bank.orderedIds);
    const choiceOrderByQuestionId: Record<string, ChoiceOrder> = {};
    for (const questionId of questionOrder) {
      const question = this.bank.get(questionId);
      choiceOrderByQuestionId[questionId] = shuffle(question.choices.map((_, index) => index));
    }

    const updated = sessionRegistry.update(sessionId, {
      status: "in-progress",
      questionOrder,
      choiceOrderByQuestionId,
    })!;
    persistCheckpoint(updated);
    return updated;
  }

  /** Entrega la primera pregunta tras la autenticación (no hay respuesta previa que dispare el avance). */
  requestFirstQuestion(sessionId: string): void {
    const state = this.requireSession(sessionId);
    if (state.status !== "in-progress" || state.currentQuestionIndex !== -1) {
      return; // ya se entregó una pregunta previamente; sin retroceso.
    }
    this.advanceTo(sessionId, 0);
  }

  /** Procesa la respuesta del alumno al reactivo vigente y avanza al siguiente. */
  submitAnswer(sessionId: string, questionId: string, selectedChoiceIndex: number): void {
    const state = this.requireSession(sessionId);
    if (state.status !== "in-progress") return;

    // Validación perezosa de doble chequeo (ADR-012): si el tiempo ya expiró,
    // el avance forzado ya ocurrió (o ocurre ahora) y esta respuesta llega tarde.
    if (this.enforceTimeoutIfExpired(sessionId)) return;

    const currentQuestionId = state.questionOrder[state.currentQuestionIndex];
    if (currentQuestionId !== questionId) return; // fuera de orden: se ignora (server-side truth).

    const question = this.bank.get(questionId);
    const choiceOrder = state.choiceOrderByQuestionId[questionId]!;
    const originalChoiceIndex = choiceOrder[selectedChoiceIndex];
    const correct = originalChoiceIndex === question.correctChoiceIndex;

    this.clearTimer(sessionId);
    const updated = sessionRegistry.update(sessionId, {
      answers: [
        ...state.answers,
        { questionId, selectedChoiceIndex, correct, answeredAtMs: Date.now() },
      ],
    })!;
    persistCheckpoint(updated);

    this.advanceTo(sessionId, state.currentQuestionIndex + 1);
  }

  /** Anula la sesión (infracción o cancelación manual del admin), limpia timers,
   * persiste el checkpoint final y notifica al cliente. */
  terminateSession(sessionId: string, reason: InfractionReasonCode): void {
    this.clearTimer(sessionId);
    const updated = sessionRegistry.update(sessionId, {
      status: "terminated-by-infraction",
      terminationReason: reason,
    });
    if (!updated) return;
    persistCheckpoint(updated);
    this.deliver(sessionId, { type: "session-terminated", sessionId, timestamp: Date.now(), reason });
  }

  private advanceTo(sessionId: string, nextIndex: number): void {
    const state = this.requireSession(sessionId);

    if (nextIndex >= state.questionOrder.length) {
      this.clearTimer(sessionId);
      const completed = sessionRegistry.update(sessionId, {
        status: "completed",
        currentQuestionIndex: nextIndex,
        currentQuestionStartedAtMs: null,
      })!;
      persistCheckpoint(completed);
      this.deliver(sessionId, {
        type: "exam-completed",
        sessionId,
        timestamp: Date.now(),
        correctAnswers: completed.answers.filter((answer) => answer.correct).length,
        totalQuestions: completed.questionOrder.length,
      });
      return;
    }

    const questionId = state.questionOrder[nextIndex]!;
    const question = this.bank.get(questionId);
    const choiceOrder = state.choiceOrderByQuestionId[questionId]!;
    const shuffledChoices = choiceOrder.map((originalIndex) => question.choices[originalIndex]!);

    const updated = sessionRegistry.update(sessionId, {
      currentQuestionIndex: nextIndex,
      currentQuestionStartedAtMs: Date.now(),
    })!;
    persistCheckpoint(updated);

    this.scheduleTimeout(sessionId, questionId, question.secondsAllowed);

    this.deliver(sessionId, {
      type: "next-question-response",
      sessionId,
      timestamp: Date.now(),
      questionId,
      questionIndex: nextIndex,
      totalQuestions: updated.questionOrder.length,
      prompt: question.prompt,
      choices: shuffledChoices,
      secondsAllowed: question.secondsAllowed,
    });
  }

  private scheduleTimeout(sessionId: string, questionId: string, secondsAllowed: number): void {
    this.clearTimer(sessionId);
    const timer = setTimeout(() => {
      this.forceAdvanceIfStillCurrent(sessionId, questionId);
    }, secondsAllowed * 1000);
    this.timers.set(sessionId, timer);
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  /** Guard idempotente (ADR-012): solo avanza si la pregunta vigente sigue siendo `questionId`. */
  private forceAdvanceIfStillCurrent(sessionId: string, questionId: string): void {
    const state = sessionRegistry.get(sessionId);
    if (!state || state.status !== "in-progress") return;
    if (state.questionOrder[state.currentQuestionIndex] !== questionId) return;
    this.advanceTo(sessionId, state.currentQuestionIndex + 1);
  }

  /** Verificación perezosa (ADR-012). Devuelve `true` si forzó (o ya forzó) un avance por expiración. */
  private enforceTimeoutIfExpired(sessionId: string): boolean {
    const state = this.requireSession(sessionId);
    if (state.status !== "in-progress" || state.currentQuestionStartedAtMs === null) return false;

    const questionId = state.questionOrder[state.currentQuestionIndex]!;
    const question = this.bank.get(questionId);
    const elapsedMs = Date.now() - state.currentQuestionStartedAtMs;
    if (elapsedMs < question.secondsAllowed * 1000) return false;

    this.forceAdvanceIfStillCurrent(sessionId, questionId);
    return true;
  }

  private requireSession(sessionId: string): SessionState {
    const state = sessionRegistry.get(sessionId);
    if (!state) {
      throw new Error(`Sesión desconocida: ${sessionId}`);
    }
    return state;
  }

  private deliver(sessionId: string, message: ControlMessage): void {
    const send = this.channels.get(sessionId);
    if (!send) return;
    send(encodeControlFrame(message));
  }
}

export const questionFlowEngine = new QuestionFlowEngine(loadQuestionBank());
