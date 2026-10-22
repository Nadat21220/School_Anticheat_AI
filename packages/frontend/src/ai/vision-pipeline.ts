import { FilesetResolver, FaceLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
import type { InfractionReasonCode } from "@proctoring/shared";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const OBJECT_DETECTOR_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

const SAMPLE_INTERVAL_MS = 1000;
// Un solo cuadro sin rostro (arranque de cámara, auto-exposición, parpadeo,
// mirar el teclado un momento) no debe anular el examen. Se exige
// persistencia sostenida de varios segundos antes de disparar.
const CONSECUTIVE_CYCLES_TO_TRIGGER = 8;
// Solo el celular es inequívoco como objeto prohibido; "laptop"/"book"/"remote"
// generan demasiados falsos positivos con objetos normales de escritorio
// (libretas, el propio monitor, etc.), así que se excluyen por ahora.
const PROHIBITED_OBJECT_CLASSES = new Set(["cell phone"]);
const OBJECT_SCORE_THRESHOLD = 0.7;
// Downscale antes de inferir: en hardware sin aceleración GPU real, correr los
// modelos sobre el frame completo de la cámara bloquea el hilo principal lo
// suficiente para congelar los clics de la UI. Un frame pequeño reduce el
// costo de inferencia drásticamente sin afectar la detección (rostro/objeto
// grande en cuadro sigue siendo detectable a baja resolución).
const INFERENCE_WIDTH = 192;
const INFERENCE_HEIGHT = 144;

/**
 * Pipeline único secuencial por frame (ADR-005): FaceLandmarker (rostros +
 * head pose) y ObjectDetector sobre el mismo frame, muestreado cada 750ms.
 */
export class VisionPipeline {
  private faceLandmarker: FaceLandmarker | null = null;
  private objectDetector: ObjectDetector | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly inferenceCanvas = document.createElement("canvas");
  private readonly inferenceCtx: CanvasRenderingContext2D;
  private readonly consecutiveCounts = new Map<InfractionReasonCode, number>();

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onInfraction: (reason: InfractionReasonCode) => void,
  ) {
    this.inferenceCanvas.width = INFERENCE_WIDTH;
    this.inferenceCanvas.height = INFERENCE_HEIGHT;
    this.inferenceCtx = this.inferenceCanvas.getContext("2d", { willReadFrequently: true })!;
  }

  async start(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);

    this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 2,
      outputFacialTransformationMatrixes: false,
    });

    this.objectDetector = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_DETECTOR_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      scoreThreshold: OBJECT_SCORE_THRESHOLD,
    });

    this.running = true;
    this.timer = setInterval(() => this.runCycle(), SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.faceLandmarker?.close();
    this.objectDetector?.close();
  }

  private runCycle(): void {
    if (!this.running || !this.faceLandmarker || !this.objectDetector) return;
    if (this.video.readyState < 2) return;

    const timestampMs = performance.now();
    this.inferenceCtx.drawImage(this.video, 0, 0, INFERENCE_WIDTH, INFERENCE_HEIGHT);

    const faceResult = this.faceLandmarker.detectForVideo(this.inferenceCanvas, timestampMs);
    const faceCount = faceResult.faceLandmarks.length;

    this.reportIfPersistent("FACE_ABSENT", faceCount === 0);
    this.reportIfPersistent("MULTIPLE_FACES_DETECTED", faceCount > 1);

    // HEAD_POSE_DEVIATION queda deshabilitado por ahora: su cálculo depende de
    // la convención exacta de ejes de la matriz de transformación facial de
    // MediaPipe, que no se pudo validar empíricamente con una cámara real en
    // este entorno. Habilitarlo sin esa validación arriesga falsos positivos
    // (anulaciones sin motivo real). FACE_ABSENT y MULTIPLE_FACES_DETECTED no
    // dependen de esa matriz y son fiables.

    const objectResult = this.objectDetector.detectForVideo(this.inferenceCanvas, timestampMs);
    const prohibited = objectResult.detections.some((detection) =>
      detection.categories.some((category) =>
        PROHIBITED_OBJECT_CLASSES.has((category.categoryName ?? "").toLowerCase()),
      ),
    );
    this.reportIfPersistent("PROHIBITED_OBJECT_DETECTED", prohibited);
  }

  /** Exige `CONSECUTIVE_CYCLES_TO_TRIGGER` ciclos seguidos antes de reportar
   * la infracción, para no anular el examen por un cuadro suelto (arranque
   * de cámara, parpadeo, auto-exposición). */
  private reportIfPersistent(reason: InfractionReasonCode, present: boolean): void {
    if (!present) {
      this.consecutiveCounts.set(reason, 0);
      return;
    }
    const count = (this.consecutiveCounts.get(reason) ?? 0) + 1;
    this.consecutiveCounts.set(reason, count);
    if (count >= CONSECUTIVE_CYCLES_TO_TRIGGER) {
      this.onInfraction(reason);
    }
  }
}
