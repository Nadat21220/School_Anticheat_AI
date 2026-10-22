import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

/**
 * Ingesta de chunks de video por sesión (ADR-002): un WriteStream en modo
 * append por sesión de examen, alimentado por los fragmentos binarios que
 * llegan demultiplexados desde el WebSocket (ADR-003).
 */

const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? join(process.cwd(), "evidence");

export class SessionRecorder {
  private readonly streams = new Map<string, WriteStream>();

  private streamFor(sessionId: string): WriteStream {
    const existing = this.streams.get(sessionId);
    if (existing) return existing;

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const filePath = join(EVIDENCE_DIR, `${sessionId}.webm`);
    const stream = createWriteStream(filePath, { flags: "a" });
    this.streams.set(sessionId, stream);
    return stream;
  }

  append(sessionId: string, chunk: Uint8Array): void {
    this.streamFor(sessionId).write(chunk);
  }

  close(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    stream.end();
    this.streams.delete(sessionId);
  }
}

export const sessionRecorder = new SessionRecorder();
