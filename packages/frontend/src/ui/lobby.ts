import {
  checkVirtualCamera,
  hasMultipleMonitors,
  requestCameraAndMicrophone,
  requestMonitorScreenShare,
  stopStream,
  InvalidDisplaySurfaceError,
} from "../media/device-checks.js";

type CheckId = "monitors" | "camera-mic" | "virtual-camera" | "screen-share" | "fullscreen";
type CheckState = "pending" | "running" | "ok" | "fail";

interface CheckDefinition {
  id: CheckId;
  label: string;
}

const CHECKS: readonly CheckDefinition[] = [
  { id: "monitors", label: "Validar monitor único" },
  { id: "camera-mic", label: "Permisos de cámara y micrófono" },
  { id: "virtual-camera", label: "Verificar que la cámara sea física" },
  { id: "screen-share", label: "Compartir pantalla completa (monitor)" },
  { id: "fullscreen", label: "Entrar en modo pantalla completa" },
];

export interface LobbyVerifiedContext {
  studentId: string;
  cameraStream: MediaStream;
  screenStream: MediaStream;
}

export function mountLobby(
  root: HTMLElement,
  onVerified: (ctx: LobbyVerifiedContext) => void,
): void {
  root.innerHTML = `
    <div class="lobby-card">
      <h1>Verificación previa al examen</h1>
      <p class="subtitle">Completa los siguientes pasos para iniciar tu evaluación supervisada.</p>
      <div id="lobby-error-slot"></div>
      <div class="lobby-field">
        <label for="student-id">Matrícula</label>
        <input id="student-id" type="text" placeholder="Ej. A01234567" autocomplete="off" />
      </div>
      <ul class="checklist">
        ${CHECKS.map(
          (check) => `<li id="check-${check.id}" data-state="pending"><span class="status-dot"></span><span>${check.label}</span></li>`,
        ).join("")}
      </ul>
      <button id="start-button" class="lobby-button">Iniciar verificación</button>
    </div>
  `;

  const errorSlot = root.querySelector<HTMLDivElement>("#lobby-error-slot")!;
  const studentIdInput = root.querySelector<HTMLInputElement>("#student-id")!;
  const startButton = root.querySelector<HTMLButtonElement>("#start-button")!;

  function setCheckState(id: CheckId, state: CheckState): void {
    const item = root.querySelector<HTMLLIElement>(`#check-${id}`)!;
    item.dataset.state = state;
    item.classList.remove("ok", "fail");
    if (state === "ok") item.classList.add("ok");
    if (state === "fail") item.classList.add("fail");
  }

  function showError(message: string): void {
    errorSlot.innerHTML = `<div class="error-banner">${message}</div>`;
  }

  function clearError(): void {
    errorSlot.innerHTML = "";
  }

  startButton.addEventListener("click", () => {
    void runVerificationFlow();
  });

  async function runVerificationFlow(): Promise<void> {
    const studentId = studentIdInput.value.trim();
    if (studentId.length === 0) {
      showError("Ingresa tu matrícula antes de continuar.");
      return;
    }

    clearError();
    startButton.disabled = true;
    studentIdInput.disabled = true;

    let cameraStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;

    try {
      // 1. Monitor único
      setCheckState("monitors", "running");
      if (hasMultipleMonitors()) {
        setCheckState("monitors", "fail");
        showError(
          "Se detectaron múltiples monitores conectados. Desconecta los monitores adicionales y vuelve a intentarlo.",
        );
        return;
      }
      setCheckState("monitors", "ok");

      // 2. Permisos de cámara y micrófono
      setCheckState("camera-mic", "running");
      try {
        cameraStream = await requestCameraAndMicrophone();
      } catch {
        setCheckState("camera-mic", "fail");
        showError("No se pudo acceder a la cámara/micrófono. Concede los permisos solicitados por el navegador.");
        return;
      }
      setCheckState("camera-mic", "ok");

      // 3. Cámara virtual
      setCheckState("virtual-camera", "running");
      const virtualCameraResult = await checkVirtualCamera();
      if (virtualCameraResult.detected) {
        setCheckState("virtual-camera", "fail");
        showError(
          `Se detectó un dispositivo de cámara virtual (${virtualCameraResult.matchedLabel ?? "desconocido"}). Desactívalo y usa una cámara física.`,
        );
        return;
      }
      setCheckState("virtual-camera", "ok");

      // 4. Compartir pantalla completa (monitor)
      setCheckState("screen-share", "running");
      try {
        screenStream = await requestMonitorScreenShare();
      } catch (err) {
        setCheckState("screen-share", "fail");
        if (err instanceof InvalidDisplaySurfaceError) {
          showError("Debes compartir el MONITOR COMPLETO, no una pestaña ni una ventana. Vuelve a intentarlo.");
        } else {
          showError("No se pudo capturar la pantalla. Debes conceder el permiso de compartir pantalla.");
        }
        return;
      }
      setCheckState("screen-share", "ok");

      // 5. Fullscreen
      setCheckState("fullscreen", "running");
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        setCheckState("fullscreen", "fail");
        showError("No se pudo activar el modo de pantalla completa.");
        return;
      }
      setCheckState("fullscreen", "ok");

      root.innerHTML = `<div class="lobby-card"><div class="success-banner">Verificación completa. Iniciando examen…</div></div>`;
      onVerified({ studentId, cameraStream, screenStream });
    } catch (err) {
      showError(`Error inesperado durante la verificación: ${(err as Error).message}`);
      stopStream(cameraStream);
      stopStream(screenStream);
    } finally {
      if (document.body.contains(startButton)) {
        startButton.disabled = false;
        studentIdInput.disabled = false;
      }
    }
  }
}
