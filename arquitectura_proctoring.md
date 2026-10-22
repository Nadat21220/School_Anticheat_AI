# Arquitectura — Sistema Web Proctoring de Tolerancia Cero

> Documento *ground truth*. Se actualiza únicamente después de que el usuario confirma cada decisión registrada en `bitacora_decisiones.md`. No contiene código, solo diseño, contratos y esquemas vigentes.

## 0. Estado del documento
- Versión: 1.1
- Última decisión incorporada: ADR-012 (cumplimiento del timer). Scaffold físico creado y validado (typecheck+build+arranque real); módulo `exam-engine/question-flow.ts` implementado y validado funcionalmente.

## 0.1 Stack tecnológico confirmado
- **Backend:** Node.js + TypeScript, framework **Fastify** + `@fastify/websocket` (WebSocket nativo, sin socket.io). Validación de payloads vía JSON Schema nativo de Fastify.
- **Frontend:** HTML5 + CSS3 + TypeScript modular (APIs nativas: MediaDevices, MediaRecorder, Screen Capture, Page Visibility, Fullscreen, Beacon API) + `@mediapipe/tasks-vision`.
- **Transporte:** un único WebSocket (`@fastify/websocket`) por sesión de examen, multiplexando (a) mensajes de control/telemetría en JSON y (b) frames binarios de video `.webm`. El servidor escribe cada chunk recibido con `fs.createWriteStream` (modo append) a un archivo por sesión.
- **Framing del WebSocket (ADR-003):** primer byte de cada mensaje = tipo (`0x00` control JSON UTF-8, `0x01` fragmento binario de video). El cliente trocea cada chunk `.webm` en sub-fragmentos ≤64KB y nunca mezcla tipos en un mismo mensaje; las alertas de kill-switch se envían como mensaje de control independiente de forma inmediata, sin esperar a que termine el chunk de video en curso. El servidor demultiplexa por ese byte y rutea a: (a) lógica de examen/infracciones, o (b) `WriteStream` de la sesión.
- **Motor de examen / server-side truth (ADR-004):** `SessionState` en memoria del proceso por `session_id` (orden de preguntas e incisos aleatorizado una sola vez al iniciar, índice de pregunta actual, `timestamp` de inicio del reactivo en curso). El tiempo restante (45s/reactivo) se calcula siempre server-side con `Date.now()` contra ese `timestamp`; el cliente nunca es fuente de verdad del tiempo. Checkpoint persistido a disco/DB en cada transición de pregunta para recuperación ante caída del proceso (medio de persistencia exacto pendiente, ligado a la sección 6 — Esquemas de datos).
- **IA de visión en cliente (ADR-005):** un único pipeline en el hilo principal (sin Web Workers), `@mediapipe/tasks-vision`, ejecutado por ciclo de muestreo (500ms-1s, valor exacto pendiente): primero `FaceLandmarker` (0/1/N rostros, landmarks 3D, matriz de transformación para head pose/Euler) y luego `ObjectDetector` (modelo ligero, ej. EfficientDet-Lite) sobre el mismo frame de la webcam. Pendiente: frecuencia exacta, umbrales de Euler para "desvío reiterado de mirada", y lista de clases de objetos prohibidos mapeadas a infracciones.
- **Destrucción DOM / Kill Switch (ADR-006):** función única `triggerKillSwitch(reason)` invocada por todos los sensores (visibilitychange, blur, fullscreenchange, `track.onended`, atajos bloqueados, IA). Ejecuta de forma síncrona, en el mismo tick del evento: vaciar el contenedor de preguntas (`innerHTML=''`/remoción) y montar la pantalla de bloqueo roja. El `sendBeacon` con el payload de infracción (Fase 4) se dispara después, de forma asíncrona, sin que ningún sensor espere confirmación del servidor antes de destruir el DOM.
- **Resiliencia de red (ADR-007):** cola en memoria (array) de chunks de video (ya troceados por ADR-003) y mensajes de control pendientes. Gestor de reconexión WS con backoff exponencial; al reconectar, reenvía la cola en el orden original antes de continuar en vivo. Sin IndexedDB; `sendBeacon` reservado exclusivamente para el payload final de infracción (Fase 4). Riesgo aceptado: un corte de red simultáneo con cierre/recarga de pestaña pierde el buffer no enviado (mitigado porque ese cierre ya dispara el kill-switch por otro sensor).
- **Marca de agua dinámica (ADR-008):** overlay `<div>` absoluto/fixed semitransparente sobre el área de preguntas (patrón repetido con nombre, matrícula, IP, timestamp), `opacity` baja, `pointer-events:none`, combinado con `user-select:none`. `MutationObserver` vigila el nodo y su padre, reconstruyéndolo ante remoción o alteración de atributos/estilos. Riesgo aceptado: ventana teórica de microsegundos entre eliminación y reconstrucción.
- **Persistencia de checkpoints (ADR-010):** un archivo JSON por sesión (`checkpoints/<sessionId>.json`), sobrescrito por completo en cada transición de pregunta.
- **Banco de preguntas (ADR-011):** archivo JSON estático (`packages/backend/questions/exam-default.json`), cargado una sola vez al iniciar el proceso y mantenido en memoria.
- **Cumplimiento del timer de 45s (ADR-012):** híbrido — `setTimeout` proactivo programado al entregar cada pregunta que fuerza el avance automático al expirar, más validación perezosa de doble chequeo (`Date.now()` contra `currentQuestionStartedAtMs`) en cada mensaje de control entrante. Guard idempotente por identidad de pregunta vigente evita doble avance.

## 1. Resumen del sistema
Plataforma de evaluación supervisada (web proctoring) de tolerancia cero. Captura cámara/micrófono/pantalla completa del alumno, aplica sensores de abandono/pérdida de foco/salida de fullscreen, ejecuta IA de visión por computadora en cliente, y usa el servidor como única fuente de verdad para preguntas, temporizador y calificación. Ante cualquier infracción, destruye el DOM del examen en <50ms y notifica al servidor vía `sendBeacon`.

## 2. Decisiones arquitectónicas pendientes (orden de abordaje)
1. ~~Stack Backend e infraestructura de recepción de streaming/alertas~~ ✅ ADR-001
2. ~~Arquitectura de ingesta de chunks de video (.webm)~~ ✅ ADR-002
3. ~~Protocolo de framing/priorización dentro del WebSocket único~~ ✅ ADR-003
4. ~~Motor de aleatorización y entrega secuencial de preguntas~~ ✅ ADR-004
5. ~~Umbrales y configuración de MediaPipe~~ ✅ ADR-005
6. ~~Estrategia de protección DOM / destrucción en <50ms~~ ✅ ADR-006
7. ~~Estrategia de resiliencia de red para subida de evidencia~~ ✅ ADR-007
8. ~~Marca de agua dinámica~~ ✅ ADR-008

**Todas las decisiones arquitectónicas listadas quedaron resueltas (ADR-001 a ADR-008). Siguiente paso: iniciar implementación de código por módulos, empezando por Fase 1 (Lobby/Verificación), presentando opciones puntuales solo para sub-decisiones críticas no cubiertas aún (ej. estructura exacta de carpetas, esquema de DB de checkpoints).**

## 3. Arquitectura general
_(Pendiente — se documentará tras decidir el stack backend. Incluirá diagrama Mermaid de topología cliente-servidor.)_

## 4. Contratos de API
_(Pendiente)_

## 5. Estructura de carpetas (ADR-009)
Monorepo con **pnpm workspaces**:

```
proctoring-monorepo/
├── package.json              (workspaces: ["packages/*"])
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── shared/                # tipos/contratos compartidos (fuente de verdad de tipos)
│   │   ├── src/
│   │   │   ├── ws-protocol.ts   (framing ADR-003: tipos de mensaje control/video)
│   │   │   ├── session.ts       (SessionState, InfractionReason — ADR-004/ADR-006)
│   │   │   └── index.ts
│   │   └── package.json
│   ├── backend/
│   │   ├── src/
│   │   │   ├── server.ts        (bootstrap Fastify + @fastify/websocket)
│   │   │   ├── ws/               (demux por byte de tipo, ADR-003)
│   │   │   ├── exam-engine/      (SessionState en memoria + checkpoint, ADR-004)
│   │   │   ├── ingest/           (WriteStream por sesión, ADR-002)
│   │   │   └── routes/
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── sensors/          (visibilitychange, blur, fullscreenchange, atajos)
│       │   ├── media/            (getUserMedia, getDisplayMedia, MediaRecorder)
│       │   ├── ai/               (pipeline MediaPipe, ADR-005)
│       │   ├── kill-switch/      (triggerKillSwitch, ADR-006)
│       │   ├── network/          (buffer + reconexión WS, ADR-007)
│       │   ├── watermark/        (overlay + MutationObserver, ADR-008)
│       │   └── ui/
│       ├── index.html
│       └── package.json
└── arquitectura_proctoring.md / bitacora_decisiones.md / estado_actual.json
```

- `packages/shared` es importado como dependencia local tanto por `backend` como por `frontend` (sin duplicación de tipos); cualquier cambio en un contrato (framing WS, `SessionState`) rompe el build del lado que no se actualizó, reforzando "servidor como única fuente de verdad".
- `tsconfig.base.json` en la raíz + project references para que el chequeo de tipos cruzado funcione sin fricción.

## 6. Esquemas de datos
_(Pendiente)_

## 7. Matriz de vectores de ataque mitigados vs. límites del sandbox
_(Pendiente — se construye incrementalmente a medida que se implementa cada módulo)_
