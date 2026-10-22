import type { SessionState } from "@proctoring/shared";

/**
 * Registro en memoria de sesiones de examen activas (ADR-004).
 * Única fuente de verdad de estado de sesión en el proceso del backend.
 * La lógica de aleatorización de preguntas/incisos y el motor de temporizador
 * se implementan como módulo aparte (exam-engine/question-flow.ts, pendiente).
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionState>();

  create(sessionId: string, studentId: string): SessionState {
    const state: SessionState = {
      sessionId,
      studentId,
      status: "lobby",
      questionOrder: [],
      choiceOrderByQuestionId: {},
      currentQuestionIndex: -1,
      currentQuestionStartedAtMs: null,
      answers: [],
      terminationReason: null,
      createdAtMs: Date.now(),
      lastCheckpointAtMs: Date.now(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, patch: Partial<SessionState>): SessionState | undefined {
    const current = this.sessions.get(sessionId);
    if (!current) return undefined;
    const next: SessionState = { ...current, ...patch, lastCheckpointAtMs: Date.now() };
    this.sessions.set(sessionId, next);
    return next;
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  list(): SessionState[] {
    return [...this.sessions.values()];
  }
}

export const sessionRegistry = new SessionRegistry();
