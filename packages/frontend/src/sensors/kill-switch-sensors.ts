import type { InfractionReasonCode } from "@proctoring/shared";

export interface SensorTracks {
  screenTracks: readonly MediaStreamTrack[];
  cameraTracks: readonly MediaStreamTrack[];
}

/**
 * Instala todos los sensores de abandono/manipulación (enunciado original,
 * sección 2 y 3) y los conecta a un único punto de entrada `trigger`.
 * Devuelve una función para desinstalar todos los listeners.
 */
const FOCUS_SENSOR_GRACE_MS = 1500;

export function installKillSwitchSensors(
  trigger: (reason: InfractionReasonCode) => void,
  tracks: SensorTracks,
): () => void {
  // Al entrar a fullscreen justo después de compartir pantalla, el propio
  // navegador/SO puede generar un parpadeo de foco (barra/indicador de
  // "compartiendo pantalla", transición de fullscreen). Se ignora ese ruido
  // de arranque en vez de anular el examen por un falso positivo.
  let focusSensorsArmed = false;
  setTimeout(() => {
    focusSensorsArmed = true;
  }, FOCUS_SENSOR_GRACE_MS);

  function onVisibilityChange(): void {
    if (focusSensorsArmed && document.hidden) trigger("TAB_HIDDEN");
  }
  function onBlur(): void {
    if (focusSensorsArmed) trigger("WINDOW_BLUR");
  }
  function onFullscreenChange(): void {
    if (focusSensorsArmed && !document.fullscreenElement) trigger("FULLSCREEN_EXIT");
  }
  function blockEvent(event: Event): void {
    event.preventDefault();
  }
  function onKeyDown(event: KeyboardEvent): void {
    const isDevTools = event.key === "F12";
    const isBlockedCtrlCombo =
      event.ctrlKey && ["c", "v", "p", "Tab"].includes(event.key);
    const isAltTab = event.altKey && event.key === "Tab";

    if (isDevTools || isBlockedCtrlCombo || isAltTab) {
      event.preventDefault();
      if (isDevTools) trigger("DEVTOOLS_SHORTCUT_BLOCKED");
    }
  }
  function onScreenTrackEnded(): void {
    trigger("SCREEN_SHARE_ENDED");
  }
  function onCameraTrackEnded(): void {
    trigger("CAMERA_OR_MIC_ENDED");
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onBlur);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("contextmenu", blockEvent);
  document.addEventListener("copy", blockEvent);
  document.addEventListener("paste", blockEvent);
  document.addEventListener("keydown", onKeyDown);

  tracks.screenTracks.forEach((track) => track.addEventListener("ended", onScreenTrackEnded));
  tracks.cameraTracks.forEach((track) => track.addEventListener("ended", onCameraTrackEnded));

  return function uninstall(): void {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("contextmenu", blockEvent);
    document.removeEventListener("copy", blockEvent);
    document.removeEventListener("paste", blockEvent);
    document.removeEventListener("keydown", onKeyDown);
    tracks.screenTracks.forEach((track) => track.removeEventListener("ended", onScreenTrackEnded));
    tracks.cameraTracks.forEach((track) => track.removeEventListener("ended", onCameraTrackEnded));
  };
}
