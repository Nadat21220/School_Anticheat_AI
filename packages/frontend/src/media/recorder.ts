/**
 * MediaRecorder sobre el stream compuesto, emitiendo chunks .webm cada
 * 3-5 segundos (ADR-002), entregados al callback para su envío por WS.
 */
export class EvidenceRecorder {
  private recorder: MediaRecorder | null = null;

  constructor(private readonly onChunk: (chunk: Uint8Array) => void) {}

  start(stream: MediaStream, timesliceMs = 4000): void {
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";

    this.recorder = new MediaRecorder(stream, { mimeType });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      void event.data.arrayBuffer().then((buffer) => this.onChunk(new Uint8Array(buffer)));
    };
    this.recorder.start(timesliceMs);
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.recorder = null;
  }
}
