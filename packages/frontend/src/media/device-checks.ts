/**
 * Validaciones de dispositivos y pantalla para la Fase 1 (Lobby).
 */

const VIRTUAL_CAMERA_NAME_PATTERNS = [
  /virtual/i,
  /obs/i,
  /manycam/i,
  /snap\s?camera/i,
  /v4l2loopback/i,
  /droidcam/i,
  /iriun/i,
];

export function hasMultipleMonitors(): boolean {
  const screenWithExtended = window.screen as Screen & { isExtended?: boolean };
  return screenWithExtended.isExtended === true;
}

export interface VirtualCameraCheckResult {
  detected: boolean;
  matchedLabel?: string;
}

/** Requiere que ya se haya concedido permiso de cámara (labels visibles tras getUserMedia). */
export async function checkVirtualCamera(): Promise<VirtualCameraCheckResult> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((device) => device.kind === "videoinput");

  for (const device of videoInputs) {
    if (VIRTUAL_CAMERA_NAME_PATTERNS.some((pattern) => pattern.test(device.label))) {
      return { detected: true, matchedLabel: device.label };
    }
  }
  return { detected: false };
}

export async function requestCameraAndMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 } },
    audio: true,
  });
}

export class InvalidDisplaySurfaceError extends Error {
  constructor(public readonly actualSurface: string | undefined) {
    super(`Se requiere compartir el monitor completo, se recibió: ${actualSurface ?? "desconocido"}`);
  }
}

/** Solicita captura de pantalla y exige estrictamente displaySurface === "monitor". */
export async function requestMonitorScreenShare(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" } as MediaTrackConstraints,
    audio: false,
  });

  const [track] = stream.getVideoTracks();
  const settings = track?.getSettings();

  if (settings?.displaySurface !== "monitor") {
    stream.getTracks().forEach((t) => t.stop());
    throw new InvalidDisplaySurfaceError(settings?.displaySurface);
  }

  return stream;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
