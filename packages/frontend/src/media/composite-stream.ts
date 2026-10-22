/**
 * Compone pantalla + cámara (picture-in-picture) en un único MediaStream
 * vía canvas, para que MediaRecorder produzca un solo .webm coherente
 * (requisito de ADR-002: un único WriteStream por sesión en el servidor).
 */
export function createCompositeStream(cameraStream: MediaStream, screenStream: MediaStream): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;

  const screenVideo = document.createElement("video");
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  void screenVideo.play();

  const cameraVideo = document.createElement("video");
  cameraVideo.srcObject = cameraStream;
  cameraVideo.muted = true;
  void cameraVideo.play();

  let running = true;

  function draw(): void {
    if (!running) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (screenVideo.readyState >= 2) {
      ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    }
    if (cameraVideo.readyState >= 2) {
      const pipWidth = 240;
      const pipHeight = 180;
      ctx.drawImage(
        cameraVideo,
        canvas.width - pipWidth - 16,
        canvas.height - pipHeight - 16,
        pipWidth,
        pipHeight,
      );
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(15);
  const [audioTrack] = cameraStream.getAudioTracks();
  if (audioTrack) canvasStream.addTrack(audioTrack);

  (canvasStream as MediaStream & { __stopComposite?: () => void }).__stopComposite = () => {
    running = false;
  };

  return canvasStream;
}

export function stopCompositeStream(stream: MediaStream): void {
  (stream as MediaStream & { __stopComposite?: () => void }).__stopComposite?.();
  stream.getTracks().forEach((track) => track.stop());
}
