import {
  WS_FRAME_TYPE,
  MAX_VIDEO_SUBFRAGMENT_BYTES,
  readFrameType,
  decodeControlFrame,
  encodeControlFrame,
  encodeVideoFrame,
  type ControlMessage,
} from "@proctoring/shared";

/**
 * Cliente WebSocket único por sesión (ADR-003/ADR-007): envía frames
 * encuadrados por tipo, encola en memoria si la conexión se cae y
 * reenvía en orden al reconectar (backoff exponencial).
 */
export class ExamSocketClient {
  private ws: WebSocket | null = null;
  private readonly queue: Uint8Array[] = [];
  private readonly handlers = new Set<(message: ControlMessage) => void>();
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(private readonly url: string) {}

  onMessage(handler: (message: ControlMessage) => void): void {
    this.handlers.add(handler);
  }

  connect(): void {
    this.closedByUser = false;
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.ws = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.flushQueue();
    });

    socket.addEventListener("message", (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (readFrameType(bytes) === WS_FRAME_TYPE.CONTROL) {
        const message = decodeControlFrame(bytes);
        this.handlers.forEach((handler) => handler(message));
      }
    });

    socket.addEventListener("close", () => {
      if (!this.closedByUser) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => socket.close());
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  sendControl(message: ControlMessage): void {
    this.send(encodeControlFrame(message));
  }

  sendVideoChunk(chunk: Uint8Array): void {
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_VIDEO_SUBFRAGMENT_BYTES) {
      this.send(encodeVideoFrame(chunk.subarray(offset, offset + MAX_VIDEO_SUBFRAGMENT_BYTES)));
    }
  }

  private send(frame: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      this.queue.push(frame);
    }
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(this.queue.shift()!);
    }
  }

  private scheduleReconnect(): void {
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempt, 15000);
    this.reconnectAttempt += 1;
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, delayMs);
  }
}
