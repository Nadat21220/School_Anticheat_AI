/**
 * Renderiza texto como un <canvas> (no como nodo de texto del DOM) para que
 * el contenido de preguntas/incisos no pueda seleccionarse ni copiarse.
 */
export interface TextImageOptions {
  maxWidth: number;
  fontSize?: number;
  color?: string;
  lineHeightRatio?: number;
}

export function renderTextToCanvas(text: string, options: TextImageOptions): HTMLCanvasElement {
  const { maxWidth, fontSize = 18, color = "#e8e9ed", lineHeightRatio = 1.4 } = options;
  const font = `${fontSize}px "Segoe UI", Roboto, system-ui, sans-serif`;
  const lineHeight = Math.round(fontSize * lineHeightRatio);

  const measurer = document.createElement("canvas").getContext("2d")!;
  measurer.font = font;

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && measurer.measureText(candidate).width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) lines.push(currentLine);

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.style.width = `${maxWidth}px`;
  canvas.style.height = `${lineHeight * lines.length}px`;
  canvas.width = maxWidth * dpr;
  canvas.height = lineHeight * lines.length * dpr;
  canvas.draggable = false;
  canvas.setAttribute("aria-hidden", "true");

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, 0, index * lineHeight));

  return canvas;
}
