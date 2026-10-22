import type { InfractionReasonCode } from "@proctoring/shared";

export interface KillSwitchContext {
  sessionId: string;
  examRoot: HTMLElement;
  sendInfractionAlert: (reason: InfractionReasonCode) => void;
}

let alreadyTriggered = false;

/** Reinicia el guard; llamar al montar un nuevo examen. */
export function resetKillSwitch(): void {
  alreadyTriggered = false;
}

/**
 * Único punto de entrada del kill switch (ADR-006). Síncrono: destruye el
 * DOM de inmediato, y solo después dispara la notificación al servidor.
 */
export function triggerKillSwitch(ctx: KillSwitchContext, reason: InfractionReasonCode): void {
  if (alreadyTriggered) return;
  alreadyTriggered = true;

  ctx.examRoot.innerHTML = "";
  const blockedScreen = document.createElement("div");
  blockedScreen.className = "blocked-screen";
  blockedScreen.innerHTML = `
    <h1>Examen suspendido</h1>
    <p>Se detectó uso de recursos no autorizados durante la evaluación.</p>
    <p class="blocked-reason">Motivo: ${reason}</p>
  `;
  ctx.examRoot.appendChild(blockedScreen);

  ctx.sendInfractionAlert(reason);
  sendBeaconFallback(ctx.sessionId, reason);
}

function sendBeaconFallback(sessionId: string, reason: InfractionReasonCode): void {
  if (!("sendBeacon" in navigator)) return;
  const payload = JSON.stringify({ sessionId, reason, timestamp: Date.now() });
  const blob = new Blob([payload], { type: "application/json" });
  navigator.sendBeacon("/api/infraction-beacon", blob);
}
