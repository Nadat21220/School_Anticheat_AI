import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionCheckpoint, SessionState } from "@proctoring/shared";

/**
 * Persistencia de checkpoints de sesión (ADR-010): un archivo JSON por
 * sesión, sobrescrito por completo en cada transición de pregunta.
 */

const CHECKPOINT_DIR = process.env.CHECKPOINT_DIR ?? join(process.cwd(), "checkpoints");

export function persistCheckpoint(state: SessionState): void {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const checkpoint: SessionCheckpoint = {
    sessionId: state.sessionId,
    state,
    persistedAtMs: Date.now(),
  };
  const filePath = join(CHECKPOINT_DIR, `${state.sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
}
