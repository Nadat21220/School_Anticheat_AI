# Sistema Web Proctoring de Tolerancia Cero

Monorepo (frontend + backend + shared) de una plataforma de evaluación supervisada (web proctoring). Captura cámara/micrófono/pantalla completa del alumno, aplica sensores de abandono/pérdida de foco/salida de fullscreen, ejecuta IA de visión por computadora en cliente, y usa el servidor como única fuente de verdad para preguntas, temporizador y calificación. Ante cualquier infracción, destruye el DOM del examen en <50ms y notifica al servidor vía `sendBeacon`.

## Stack

- **Backend:** Node.js + TypeScript, **Fastify** + `@fastify/websocket` (WebSocket nativo, sin socket.io).
- **Frontend:** HTML5 + CSS3 + TypeScript modular (MediaDevices, MediaRecorder, Screen Capture, Page Visibility, Fullscreen, Beacon API) + `@mediapipe/tasks-vision`.
- **Transporte:** un único WebSocket por sesión de examen, multiplexando control/telemetría (JSON) y frames binarios de video `.webm`.
- **Monorepo:** pnpm workspaces.

Detalle completo de decisiones y diseño vigente en [`arquitectura_proctoring.md`](./arquitectura_proctoring.md) y el historial en [`bitacora_decisiones.md`](./bitacora_decisiones.md).

## Estructura

```
proctoring-monorepo/
├── packages/
│   ├── shared/    # tipos/contratos compartidos (fuente de verdad de tipos)
│   ├── backend/   # servidor Fastify + WebSocket + motor de examen
│   └── frontend/  # cliente: sensores, media, IA, kill-switch, UI
├── arquitectura_proctoring.md
├── bitacora_decisiones.md
└── estado_actual.json
```

## Requisitos

- Node.js >= 20
- pnpm 9

## Instalación

```bash
pnpm install
```

## Uso

```bash
# Backend (Fastify + WS) en modo desarrollo
pnpm dev:backend

# Frontend (Vite) en modo desarrollo
pnpm dev:frontend

# Build de todos los paquetes
pnpm build

# Typecheck de todos los paquetes
pnpm typecheck
```

## Estado del proyecto

El estado actual del desarrollo (decisiones confirmadas, módulos implementados, próximos pasos) se mantiene en [`estado_actual.json`](./estado_actual.json).
