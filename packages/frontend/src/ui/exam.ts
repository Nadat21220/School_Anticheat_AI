import type { ControlMessage, InfractionReasonCode } from "@proctoring/shared";
import { ExamSocketClient } from "../network/ws-client.js";
import { EvidenceRecorder } from "../media/recorder.js";
import { createCompositeStream, stopCompositeStream } from "../media/composite-stream.js";
import { installKillSwitchSensors } from "../sensors/kill-switch-sensors.js";
import { triggerKillSwitch, resetKillSwitch } from "../kill-switch/trigger.js";
import { mountWatermark } from "../watermark/watermark.js";
import { VisionPipeline } from "../ai/vision-pipeline.js";
import { renderTextToCanvas } from "./text-to-image.js";
import type { LobbyVerifiedContext } from "./lobby.js";

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws/exam`;

export function mountExam(root: HTMLElement, ctx: LobbyVerifiedContext): void {
  resetKillSwitch();
  const sessionId = crypto.randomUUID();

  root.innerHTML = `
    <div class="exam-shell">
      <div id="question-toast" class="question-toast"></div>
      <div class="exam-header">
        <span id="exam-progress">Cargando examen…</span>
        <span id="exam-timer">--</span>
      </div>
      <div class="exam-body">
        <p id="exam-prompt"></p>
        <ul id="exam-choices" class="exam-choices"></ul>
      </div>
    </div>
  `;

  const examShell = root.querySelector<HTMLDivElement>(".exam-shell")!;
  const unmountWatermark = mountWatermark(examShell, { studentId: ctx.studentId });

  const client = new ExamSocketClient(WS_URL);
  const compositeStream = createCompositeStream(ctx.cameraStream, ctx.screenStream);
  const recorder = new EvidenceRecorder((chunk) => client.sendVideoChunk(chunk));
  recorder.start(compositeStream);

  const cameraVideoEl = document.createElement("video");
  cameraVideoEl.srcObject = ctx.cameraStream;
  cameraVideoEl.muted = true;
  cameraVideoEl.playsInline = true;
  void cameraVideoEl.play();

  const visionPipeline = new VisionPipeline(cameraVideoEl, (reason) => trigger(reason));
  void visionPipeline.start();

  const uninstallSensors = installKillSwitchSensors((reason) => trigger(reason), {
    screenTracks: ctx.screenStream.getVideoTracks(),
    cameraTracks: [...ctx.cameraStream.getVideoTracks(), ...ctx.cameraStream.getAudioTracks()],
  });

  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let teardownDone = false;

  function teardown(): void {
    if (teardownDone) return;
    teardownDone = true;
    if (timerInterval) clearInterval(timerInterval);
    uninstallSensors();
    visionPipeline.stop();
    recorder.stop();
    stopCompositeStream(compositeStream);
    unmountWatermark();
    client.close();
  }

  function trigger(reason: InfractionReasonCode): void {
    teardown();
    triggerKillSwitch(
      {
        sessionId,
        examRoot: root,
        sendInfractionAlert: (r) =>
          client.sendControl({ type: "infraction-alert", sessionId, timestamp: Date.now(), reason: r }),
      },
      reason,
    );
  }

  client.onMessage((message: ControlMessage) => {
    if (message.type === "next-question-response") {
      renderQuestion(message);
    } else if (message.type === "exam-completed") {
      teardown();
      root.innerHTML = `<div class="lobby-card"><div class="success-banner">Examen finalizado. Respuestas correctas: ${message.correctAnswers}/${message.totalQuestions}</div></div>`;
    } else if (message.type === "session-terminated") {
      // Anulación iniciada por el servidor (ej. el supervisor canceló el examen
      // desde el panel de admin): el cliente no disparó esto, solo lo acata.
      teardown();
      root.innerHTML = `
        <div class="blocked-screen">
          <h1>Examen suspendido</h1>
          <p>El supervisor canceló tu examen.</p>
          <p class="blocked-reason">Motivo: ${message.reason}</p>
        </div>
      `;
    }
  });

  function renderQuestion(message: Extract<ControlMessage, { type: "next-question-response" }>): void {
    const promptEl = root.querySelector<HTMLParagraphElement>("#exam-prompt");
    const choicesEl = root.querySelector<HTMLUListElement>("#exam-choices");
    const progressEl = root.querySelector<HTMLSpanElement>("#exam-progress");
    if (!promptEl || !choicesEl || !progressEl) return; // el DOM pudo ser destruido por el kill switch

    progressEl.textContent = `Pregunta ${message.questionIndex + 1} / ${message.totalQuestions}`;
    showQuestionToast(message.questionIndex + 1, message.totalQuestions);

    // El prompt y los incisos se renderizan como imagen (canvas), no como texto
    // del DOM, para que no puedan seleccionarse ni copiarse/pegarse.
    promptEl.innerHTML = "";
    promptEl.appendChild(renderTextToCanvas(message.prompt, { maxWidth: 600, fontSize: 19 }));

    choicesEl.innerHTML = message.choices
      .map((_, index) => `<li><button class="choice-button" data-index="${index}"></button></li>`)
      .join("");

    choicesEl.querySelectorAll<HTMLButtonElement>(".choice-button").forEach((button, index) => {
      button.appendChild(renderTextToCanvas(message.choices[index]!, { maxWidth: 540, fontSize: 16 }));
      button.addEventListener("click", () => {
        choicesEl.querySelectorAll("button").forEach((b) => {
          b.disabled = true;
        });
        client.sendControl({
          type: "answer-submit",
          sessionId,
          timestamp: Date.now(),
          questionId: message.questionId,
          selectedChoiceIndex: Number(button.dataset.index),
        });
      });
    });

    startTimerDisplay(message.secondsAllowed);
  }

  function showQuestionToast(current: number, total: number): void {
    const toast = root.querySelector<HTMLDivElement>("#question-toast");
    if (!toast) return;
    toast.textContent = `Pasaste a la pregunta ${current} de ${total}`;
    toast.classList.remove("show");
    void toast.offsetWidth; // fuerza reflow para reiniciar la animación
    toast.classList.add("show");
  }

  function startTimerDisplay(secondsAllowed: number): void {
    if (timerInterval) clearInterval(timerInterval);
    let remaining = secondsAllowed;
    const timerEl = root.querySelector<HTMLSpanElement>("#exam-timer");
    if (timerEl) timerEl.textContent = `${remaining}s`;

    timerInterval = setInterval(() => {
      remaining -= 1;
      const el = root.querySelector<HTMLSpanElement>("#exam-timer");
      if (!el) {
        if (timerInterval) clearInterval(timerInterval);
        return;
      }
      el.textContent = `${Math.max(remaining, 0)}s`;
      if (remaining <= 0 && timerInterval) clearInterval(timerInterval);
    }, 1000);
  }

  client.connect();
  client.sendControl({ type: "auth", sessionId, timestamp: Date.now(), studentId: ctx.studentId });
  setTimeout(
    () => client.sendControl({ type: "next-question-request", sessionId, timestamp: Date.now() }),
    300,
  );
}
