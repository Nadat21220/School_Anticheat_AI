# Bitácora de Decisiones (ADR) — Sistema Web Proctoring

Registro cronológico de cada módulo/decisión consultada: las opciones presentadas, la elección del usuario y su justificación técnica. Formato por entrada:

```
## ADR-XXX — <Título de la decisión>
- Fecha: AAAA-MM-DD
- Módulo/Fase relacionada:
- Opciones presentadas: (resumen de cada una con pros/contras)
- Opción elegida:
- Justificación del usuario:
- Consecuencias / impacto en arquitectura_proctoria.md:
```

---

## ADR-001 — Stack Backend e infraestructura de recepción de streaming/alertas
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 0 — Fundación del proyecto (previa a Fase 1 Lobby)
- Opciones presentadas:
  1. Node.js + TypeScript (Fastify o NestJS + ws): TS end-to-end con el cliente, Node Streams para chunks `.webm`, ecosistema maduro de WS de baja latencia. Contra: event-loop single-thread exige cuidado con bloqueos.
  2. Python + FastAPI (+ uvicorn/websockets): validación estricta con Pydantic (refuerza server-side truth), async nativo, buen camino si se añade IA de verificación en servidor. Contra: lenguaje distinto al cliente (duplicación de contratos), manejo de binarios grandes menos ergonómico, despliegue con más piezas.
  3. Node.js + TypeScript (Express + socket.io): adopción simple, reconexión automática/fallback a polling (resiliencia de red). Contra: menos estructura que NestJS, overhead de protocolo propio de socket.io sobre WS nativo.
- Opción elegida: Node.js + TypeScript, con **Fastify + @fastify/websocket** como framework base (sub-decisión resuelta en la misma sesión frente a NestJS).
- Justificación del usuario: selección directa de la opción 1 (Node/TS), y dentro de ella Fastify por bajo overhead/alto throughput para ingesta continua de chunks de video, aceptando que requerirá disciplina manual de modularización (sin DI/estructura impuesta como NestJS).
- Consecuencias / impacto en `arquitectura_proctoring.md`: Backend = Node.js + TypeScript + Fastify + `@fastify/websocket` (WS nativo, sin socket.io). Contratos de API se definirán con JSON Schema (nativo de Fastify) y se compartirán tipos TS con el cliente. Pendiente decidir en ADR-002 la arquitectura de ingesta de chunks `.webm`.

## ADR-002 — Arquitectura de ingesta de chunks de video (.webm)
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 2 — Examen y Streaming Continuo
- Opciones presentadas:
  1. WebSocket binario (mismo canal de telemetría) + `fs.createWriteStream` append por sesión: un solo canal de transporte, baja latencia, reutiliza la conexión persistente ya usada para kill-switch. Contra: pérdida del chunk en tránsito si el WS cae; riesgo de head-of-line blocking si se mezcla binario grande con mensajes de control pequeños sin priorización.
  2. HTTP POST independiente por chunk (multipart/raw) a endpoint REST dedicado, desacoplado del WS: reintento HTTP atómico por chunk, más fácil de depurar. Contra: overhead de headers por chunk cada 3-5s, más conexiones si no hay keep-alive.
  3. Cola intermedia (Redis Streams/BullMQ) entre recepción y escritura a disco: máxima resiliencia y desacople, escalabilidad horizontal. Contra: complejidad operativa desde el día 1 (requiere Redis), latencia extra, sobre-ingeniería para volumen moderado.
- Opción elegida: WebSocket binario + `fs.createWriteStream` append por sesión (opción 1).
- Justificación del usuario: selección directa de la opción de menor superficie y un solo canal de transporte reutilizando la conexión WS ya elegida en ADR-001.
- Consecuencias / impacto en `arquitectura_proctoring.md`: el mismo socket WS por sesión de examen transporta (a) mensajes de control/telemetría JSON y (b) frames binarios de video. Se deberá definir un framing/protocolo que distinga ambos tipos de mensaje (ej. primer byte o campo de tipo) y una estrategia de priorización para que alertas de kill-switch no queden bloqueadas detrás de chunks de video grandes. Cada sesión de examen abre un `WriteStream` en el servidor que se cierra al finalizar/cancelar el examen. Pendiente: estrategia de reintento/buffer en cliente si el WS se desconecta momentáneamente (se evaluará junto con el punto de Resiliencia de Red, ADR pendiente).

## ADR-003 — Framing y priorización dentro del WebSocket único
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 2 — Examen y Streaming Continuo / Fase 3 — Detección e Infracción
- Opciones presentadas:
  1. Framing por prefijo de 1 byte (0x00=control JSON, 0x01=chunk video) + chunks de video troceados (<=64KB), control siempre en mensajes separados pequeños. Simple, bajo overhead, sin libs extra. Contra: posible latencia de cola a nivel de buffer OS/TCP si no se fragmenta bien; exige disciplina en el cliente.
  2. Dos WebSockets separados (wsControl + wsMedia) correlados por `session_id`: aislamiento real de transporte, cero head-of-line blocking cruzado. Contra: doble gestión de conexión/reconexión/autenticación, más estado en servidor.
  3. Un socket + cola de prioridad en cliente (preemption a nivel de aplicación) + ACK obligatorio de alertas críticas con respaldo por `sendBeacon` si no hay ACK a tiempo. Contra: no elimina retraso de un chunk ya en vuelo; más lógica cliente a mantener.
- Opción elegida: Framing por prefijo de 1 byte + chunks de video troceados, control en mensajes separados pequeños (opción 1).
- Justificación del usuario: selección directa de la opción más simple y de menor overhead, manteniendo un solo socket por sesión (coherente con ADR-002).
- Consecuencias / impacto en `arquitectura_proctoring.md`: todo mensaje WS lleva un byte de tipo como primer byte (`0x00` = control JSON codificado en UTF-8 tras el byte, `0x01` = fragmento binario de video). El cliente trocea cada chunk `.webm` del `MediaRecorder` en sub-fragmentos de ≤64KB antes de enviarlos, nunca mezcla ambos tipos en un mismo mensaje, y las alertas de kill-switch se envían como mensaje de control independiente apenas se disparan (sin esperar a que termine el chunk de video en curso). El servidor demultiplexa por ese primer byte: tipo `0x00` → parseo JSON y ruteo a lógica de examen/infracciones; tipo `0x01` → append al `WriteStream` de la sesión (ADR-002). Pendiente definir el tamaño exacto de sub-fragmento (64KB sugerido, a validar en pruebas de rendimiento) y el reensamblado de sub-fragmentos en el servidor (se asume que el orden de llegada en un mismo socket WS es secuencial por protocolo TCP/WS, por lo que no se requiere numeración de secuencia adicional).

## ADR-004 — Motor de aleatorización y entrega secuencial de preguntas (server-side truth)
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 2 — Examen y Streaming Continuo / Reglas de negocio server-side truth
- Opciones presentadas:
  1. Estado de sesión en memoria del proceso (`Map<session_id, estado>`) + persistencia periódica a disco/DB: baja latencia, `Date.now()` server-side nunca confía en tiempo del cliente, checkpoint en cada transición de pregunta. Contra: pérdida de estado no persistido si el proceso cae entre checkpoints; no escala horizontalmente sin estado compartido/sticky sessions.
  2. Estado 100% en base de datos (ej. PostgreSQL) consultado en cada interacción: sobrevive reinicios sin pérdida, escalable horizontalmente desde el día 1, auditable directamente en DB. Contra: latencia de round-trip a DB en cada validación de tiempo, más carga en DB con alta concurrencia.
  3. Híbrido memoria (lectura/escritura rápida) + DB write-through como fuente de verdad duradera, reconstrucción en memoria al reiniciar leyendo de DB. Contra: más complejidad, dos fuentes de estado a mantener sincronizadas de forma atómica.
- Opción elegida: Estado de sesión en memoria del proceso + persistencia periódica a disco/DB (opción 1).
- Justificación del usuario: selección directa de la opción de menor latencia, priorizando simplicidad operativa sobre escalado horizontal inmediato (coherente con un despliegue de instancia única en esta etapa).
- Consecuencias / impacto en `arquitectura_proctoring.md`: cada sesión de examen se representa como un objeto en memoria (`SessionState`: `session_id`, orden de preguntas aleatorizado generado una sola vez al iniciar, orden de incisos por pregunta, índice de pregunta actual, `timestamp` de inicio del reactivo en curso). El servidor calcula el tiempo restante comparando `Date.now()` contra ese `timestamp` en cada validación — nunca se acepta un "tiempo restante" enviado por el cliente. Se persiste un checkpoint a disco/DB en cada transición de pregunta (avance, cancelación, finalización) para permitir recuperación ante caída del proceso. Pendiente (fuera de este ADR): elegir el medio de persistencia concreto (archivo JSON por sesión vs. tabla en DB ligera) — se resolverá junto con el diseño de esquemas de datos (sección 6 del documento de arquitectura).

## ADR-005 — Umbrales y configuración de MediaPipe (Head Pose / Face Landmarker / Object Detector)
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Potenciadores Avanzados Anti-Fraude — Inteligencia Artificial en el Cliente
- Opciones presentadas:
  1. Un solo pipeline secuencial por frame (FaceLandmarker con blendshapes/head pose + ObjectDetector tipo EfficientDet-Lite), baja resolución, muestreo cada 500ms-1s. Dependencia oficial única de Google, fácil de mantener. Contra: infracciones muy breves (<500ms) podrían no capturarse; latencia acumulada por procesar ambos modelos en secuencia.
  2. Dos Web Workers independientes con OffscreenCanvas (FaceLandmarker cada ~200ms, ObjectDetector cada 1-2s): mejor paralelismo real, frecuencias optimizadas por riesgo. Contra: mayor complejidad (mensajería entre workers, OffscreenCanvas + getUserMedia), más puntos de falla.
  3. Pipeline único en hilo principal con backend GPU explícito (WebGPU con fallback a WebGL) y frecuencia adaptativa por backoff según carga medida. Se auto-regula por hardware. Contra: backoff adaptativo difícil de predecir en QA; riesgo de degradar frecuencia de detección por debajo de lo aceptable en hardware limitado (conflicto con criterio de seguridad como prioridad máxima).
- Opción elegida: Un solo pipeline secuencial por frame, baja resolución y frecuencia reducida 500ms-1s (opción 1).
- Justificación del usuario: selección directa de la opción más simple y con soporte oficial, aceptando el trade-off de no capturar infracciones ultra-breves (<500ms) a cambio de menor complejidad y consumo predecible.
- Consecuencias / impacto en `arquitectura_proctoring.md`: en el hilo principal del cliente corre un único pipeline de inferencia sobre `@mediapipe/tasks-vision`: por cada ciclo de muestreo (frecuencia a fijar entre 500ms y 1s, pendiente de valor exacto en implementación) se ejecuta primero `FaceLandmarker` (detecta 0/1/N rostros, landmarks 3D y matriz de transformación para head pose/Euler angles) y después `ObjectDetector` (modelo ligero, ej. EfficientDet-Lite) sobre el mismo frame capturado de la webcam. No se usan Web Workers para este pipeline en esta fase. Pendiente (ADR futuro o detalle de implementación): valor exacto de frecuencia de muestreo, umbrales de ángulos Euler para considerar "desvío reiterado de mirada", lista de clases de objetos prohibidos a detectar y su mapeo a infracciones.

## ADR-006 — Estrategia de protección DOM / destrucción en <50ms
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 3 — Detección e Infracción (El Gatillo)
- Opciones presentadas:
  1. Listener único centralizado `triggerKillSwitch(reason)` síncrono: `innerHTML=''` (o remoción del nodo) + montaje inmediato de pantalla de bloqueo en el mismo tick, `sendBeacon` disparado después de forma asíncrona. No depende de red/servidor. Contra: listeners propios del contenedor no se liberan automáticamente (memory leak menor, mitigable).
  2. Clase CSS de "pánico" pre-cargada (`display:none !important` + overlay z-index máximo) activada por un solo `classList.toggle`: operación DOM más rápida posible. Contra: el contenido de preguntas sigue existiendo en el DOM solo oculto — vector de evasión vía DevTools, contradice el objetivo de impedir lectura del contenido.
  3. Combinación: toggle CSS instantáneo (ocultamiento en <1ms) + `innerHTML=''`/`remove()` inmediatamente después en el mismo tick, antes de que el navegador pinte el siguiente frame. Mejor de ambas, pero más pasos a coordinar en el orden exacto.
- Opción elegida: Listener único centralizado con `innerHTML=''` + reemplazo inmediato por pantalla de bloqueo, sin esperar confirmación del servidor (opción 1).
- Justificación del usuario: selección directa de la opción que elimina realmente el contenido del DOM sin depender de red, priorizando seguridad (no deja contenido inspeccionable) con buena simplicidad de implementación.
- Consecuencias / impacto en `arquitectura_proctoring.md`: existe una única función `triggerKillSwitch(reason: InfractionReason)` a la que todos los sensores (visibilitychange, blur, fullscreenchange, `track.onended`, atajos bloqueados, resultado positivo de IA) llaman como único punto de entrada. Esa función, de forma síncrona: (1) vacía el contenedor de preguntas (`innerHTML = ''` o remoción del nodo), (2) monta la pantalla de bloqueo roja, todo en el mismo ciclo de ejecución del evento — y solo después dispara de forma asíncrona el payload de `sendBeacon` (Fase 4). Ningún sensor debe esperar respuesta del servidor antes de destruir el DOM. Pendiente: limpieza explícita de listeners del contenedor destruido para evitar memory leaks menores (detalle de implementación, no bloquea diseño).

## ADR-007 — Estrategia de resiliencia de red para subida de evidencia
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Criterio rector 3 — Resiliencia de Red en la Subida de Evidencia
- Opciones presentadas:
  1. Buffer en memoria (array/cola JS) + reconexión WS con backoff exponencial, reenvío en orden al reconectar. Simple, suficiente para microcortes cortos. Contra: se pierde por completo si se cierra/recarga la pestaña durante el corte; limitado por RAM si el corte es largo.
  2. Cola persistente en IndexedDB: cada chunk/alerta se escribe antes de enviar, se borra solo tras ACK del servidor, worker de sincronización reintenta. Máxima durabilidad, sobrevive cierre de pestaña. Contra: mayor complejidad (gestión de IndexedDB, limpieza, crecimiento de storage), overhead de escritura a disco local en cada chunk.
  3. Híbrido: buffer en memoria para video + fallback a `sendBeacon` solo para la alerta crítica si el WS no reconecta a tiempo, sin IndexedDB para video. Resuelve el caso más crítico (alerta nunca se pierde) sin complejidad total de IndexedDB. Contra: el video en sí no tiene la misma garantía de durabilidad ante corte largo.
- Opción elegida: Buffer en memoria con reintento automático de reconexión WS y reenvío en orden al reconectar (opción 1).
- Justificación del usuario: selección directa de la opción más simple, aceptando el trade-off de que un cierre/recarga de pestaña durante un corte de red pierde el buffer (se asume que ese escenario ya está cubierto por otros sensores: cerrar la pestaña dispara `visibilitychange`/`beforeunload` y el kill-switch correspondiente).
- Consecuencias / impacto en `arquitectura_proctoring.md`: el cliente mantiene una cola en memoria (array) de chunks de video (ya troceados según ADR-003) y mensajes de control pendientes de confirmación. Un gestor de reconexión del WebSocket aplica backoff exponencial ante desconexión; al reconectar, vacía la cola en memoria enviando los pendientes en el orden original antes de reanudar el envío en vivo. No se usa IndexedDB ni `sendBeacon` como respaldo adicional para este flujo (el `sendBeacon` queda reservado exclusivamente para el payload final de infracción de la Fase 4, según el enunciado original). Riesgo aceptado y documentado: un corte de red que coincida con cierre/recarga de la pestaña pierde el buffer en memoria no enviado; se mitiga porque ese mismo evento de cierre ya dispara el kill-switch por otros sensores (abandono de pestaña).

## ADR-008 — Marca de agua dinámica
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Defensa en el Diseño del Examen y Reglas de Negocio
- Opciones presentadas:
  1. Overlay HTML/CSS absoluto semitransparente (texto repetido en patrón, `pointer-events:none`) + `MutationObserver` que lo re-inyecta si se detecta eliminación/alteración. Fácil de implementar, texto nítido. Contra: ventana teórica entre eliminación y reconstrucción donde una captura podría tomarse sin marca.
  2. Marca renderizada en `<canvas>` redibujada en loop (`requestAnimationFrame`) con timestamp en vivo. Más resistente a manipulación por DevTools (no hay nodo de texto que borrar). Contra: mayor costo de CPU/GPU compitiendo con MediaRecorder + MediaPipe; más complejo de estilizar/internacionalizar.
  3. Canvas (como opción 2) pero redibujado cada 1-2s + `MutationObserver` vigilando que el nodo `<canvas>` no sea removido/oculto. Balance resistencia/consumo, doble capa de defensa. Contra: más piezas moviéndose, más código a mantener.
- Opción elegida: Overlay HTML/CSS absoluto semitransparente + `MutationObserver` de re-inyección (opción 1).
- Justificación del usuario: selección directa de la opción más simple, reutilizando `MutationObserver` ya contemplado en el enunciado original, aceptando la ventana teórica mínima de evasión como riesgo de baja probabilidad.
- Consecuencias / impacto en `arquitectura_proctoring.md`: un `<div>` overlay con `position:absolute`/`fixed` sobre el área de preguntas, texto repetido en patrón tipo marca de agua de documentos (nombre, matrícula, IP, timestamp), `opacity` baja y `pointer-events:none`, coexistiendo con las reglas CSS de `user-select:none` ya definidas. Un `MutationObserver` vigila ese nodo y su padre; ante remoción o alteración de atributos/estilos clave, lo reconstruye de inmediato con los mismos datos de sesión. Riesgo aceptado y documentado: existe una ventana teórica de microsegundos entre eliminación y reconstrucción donde una captura de pantalla podría tomarse sin la marca visible; se considera un vector de evasión de baja probabilidad, no bloqueante para el diseño.

## ADR-009 — Estructura de carpetas del monorepo y gestor de paquetes
- Fecha: 2026-10-21
- Módulo/Fase relacionada: Fase 0 — Fundación del proyecto (estructura base antes de escribir código)
- Opciones presentadas:
  1. npm/pnpm workspaces: `packages/frontend`, `packages/backend`, `packages/shared` (tipos de contratos WS/sesión compartidos y verificados por el compilador). Sin herramienta de build adicional. Contra: requiere configurar bien `tsconfig` con project references/paths.
  2. Dos carpetas independientes (`frontend/`, `backend/`) sin workspace tooling, tipos duplicados a mano. Cero configuración. Contra: alto riesgo de divergencia de contratos (ADR-003/ADR-004) sin error de compilación que lo detecte — contradice "servidor como única fuente de verdad".
  3. Convención `apps/` + `packages/` estilo Turborepo/Nx, con orquestador de builds y cache. Mejor DX a mediano plazo. Contra: dependencia y curva de aprendizaje adicional, sobre-ingeniería para el tamaño actual (2 apps + 1 shared).
- Opción elegida: npm/pnpm workspaces con `packages/frontend`, `packages/backend`, `packages/shared` (opción 1); gestor de paquetes: **pnpm**.
- Justificación del usuario: selección directa de la opción con tipado compartido verificado por el compilador, sin herramienta de orquestación adicional; pnpm elegido sobre npm por eficiencia de instalación y lockfile estricto (recomendado).
- Consecuencias / impacto en `arquitectura_proctoring.md`: se fija la estructura de carpetas raíz del monorepo (ver sección 5 del documento de arquitectura). `packages/shared` contendrá los contratos TS versionados: framing WS (ADR-003), `SessionState`/`InfractionReason` (ADR-004/ADR-006), tipos de telemetría. `pnpm-workspace.yaml` declara los 3 paquetes. `tsconfig.base.json` en la raíz con project references para que `backend` y `frontend` consuman `shared` con chequeo de tipos cruzado real.

## ADR-010 — Persistencia de checkpoints de SessionState
- Fecha: 2026-10-21
- Módulo/Fase relacionada: exam-engine/question-flow.ts (sub-decisión pendiente desde ADR-004)
- Opciones presentadas:
  1. Un archivo JSON por sesión, sobrescrito completo en cada checkpoint (`fs.writeFile`). Simple, sin dependencias nuevas. Contra: sobrescribir todo el archivo es menos eficiente que append; no deja historial de transiciones previas.
  2. SQLite embebido (`better-sqlite3`) con tabla `sessions`, `UPDATE` por fila. Permite queries futuras, transacciones atómicas nativas. Contra: dependencia nativa que requiere compilación, más configuración (esquema/migraciones).
  3. Archivo JSONL append-only por sesión: una línea nueva por checkpoint, nunca se sobrescribe. Preserva historial completo auditable. Contra: archivo crece por transición (acotado por nº de preguntas); reconstruir estado requiere leer hasta la última línea.
- Opción elegida: Un archivo JSON por sesión, sobrescrito completo en cada checkpoint (opción 1).
- Justificación del usuario: selección directa de la opción más simple, sin dependencias nuevas, coherente con el uso de `fs` ya existente en `ingest/session-recorder.ts`.
- Consecuencias / impacto en `arquitectura_proctoring.md`: cada sesión persiste su `SessionCheckpoint` en `checkpoints/<sessionId>.json`, sobrescrito en cada transición de pregunta vía `fs.writeFile`. Se renuncia a historial de transiciones intermedias (solo se conserva el último checkpoint).

## ADR-011 — Origen del banco de preguntas
- Fecha: 2026-10-21
- Módulo/Fase relacionada: exam-engine/question-flow.ts
- Opciones presentadas:
  1. Archivo JSON estático en el repo, cargado una sola vez al iniciar el proceso, mantenido en memoria. Cero dependencias nuevas, versionable en git. Contra: cambiar preguntas requiere reiniciar el servidor; sin interfaz de administración.
  2. Tabla `questions` en la misma base SQLite de checkpoints. Permite futuro panel de administración. Contra: acopla esta decisión a haber elegido SQLite en ADR-010 (no elegido); sobre-ingeniería sin panel de administración planeado.
  3. Archivo de configuración por examen (múltiples JSON, uno por materia/examen). Escalable a multi-examen. Contra: más superficie de configuración (selección de archivo, validación de esquema) no exigida aún por el enunciado.
- Opción elegida: Archivo JSON estático en el repo, cargado una sola vez al iniciar el proceso (opción 1).
- Justificación del usuario: selección directa de la opción más simple, coherente con el enfoque de estado en memoria de ADR-004 y con no haber elegido SQLite en ADR-010.
- Consecuencias / impacto en `arquitectura_proctoring.md`: un archivo `questions/exam-default.json` (arreglo de `QuestionRecord`) se carga una sola vez al arrancar `server.ts` y se mantiene en memoria como banco de preguntas único del proceso.

## ADR-012 — Cumplimiento del límite de 45s por reactivo
- Fecha: 2026-10-21
- Módulo/Fase relacionada: exam-engine/question-flow.ts
- Opciones presentadas:
  1. Evaluación perezosa: el servidor solo valida tiempo transcurrido cuando llega un mensaje del cliente. Cero overhead de timers activos. Contra: si el cliente nunca envía nada tras agotarse el tiempo, la sesión queda congelada hasta que algo llegue.
  2. Timer proactivo por sesión (`setTimeout`) que fuerza el avance automático al expirar, sin esperar al cliente. Máxima fidelidad a server-side truth. Contra: requiere gestionar/cancelar/limpiar correctamente un `setTimeout` por sesión activa.
  3. Híbrido: timer proactivo (opción 2) + validación perezosa adicional en cada mensaje recibido como doble chequeo. Máxima robustez ante fallos del timer bajo carga. Contra: lógica ligeramente más compleja, debe evitar doble disparo del mismo avance.
- Opción elegida: Híbrido — timer proactivo + validación perezosa de doble chequeo (opción 3).
- Justificación del usuario: selección directa de la opción de máxima robustez, coherente con el criterio de seguridad como prioridad máxima sobre los otros dos criterios.
- Consecuencias / impacto en `arquitectura_proctoring.md`: al entregar cada pregunta se programa un `setTimeout(secondsAllowed * 1000)` que, al expirar, avanza la sesión automáticamente y notifica al cliente. Además, en cada mensaje de control entrante (`answer-submit`, `heartbeat`, `next-question-request`) se recalcula `Date.now() - currentQuestionStartedAtMs` como verificación adicional; se usa un flag/guard por sesión para evitar que el avance se ejecute dos veces (una por el timeout y otra por la verificación perezosa) si ambos caminos coinciden.

---

Con ADR-012 quedan resueltas las sub-decisiones pendientes del motor de examen. El proyecto pasa de Fase 0 (Fundación) a inicio de implementación de código (Fase 1 — Verificación/Lobby).
