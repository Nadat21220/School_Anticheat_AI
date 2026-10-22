/**
 * Fan-out de chunks de video en vivo hacia visores del panel de admin.
 * Guarda el historial de chunks de la sesión en memoria y lo reproduce
 * completo a cualquier visor que se conecte (aunque sea a mitad del examen),
 * para que su SourceBuffer de MSE siempre arranque con el header WebM.
 */
type Subscriber = (chunk: Uint8Array) => void;

interface SessionBroadcast {
  history: Uint8Array[];
  subscribers: Set<Subscriber>;
}

export class LiveBroadcast {
  private readonly sessions = new Map<string, SessionBroadcast>();

  private entryFor(sessionId: string): SessionBroadcast {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = { history: [], subscribers: new Set() };
      this.sessions.set(sessionId, entry);
    }
    return entry;
  }

  publish(sessionId: string, chunk: Uint8Array): void {
    const entry = this.entryFor(sessionId);
    entry.history.push(chunk);
    entry.subscribers.forEach((subscriber) => subscriber(chunk));
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const entry = this.entryFor(sessionId);
    entry.history.forEach((chunk) => subscriber(chunk));
    entry.subscribers.add(subscriber);
    return () => entry.subscribers.delete(subscriber);
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export const liveBroadcast = new LiveBroadcast();
