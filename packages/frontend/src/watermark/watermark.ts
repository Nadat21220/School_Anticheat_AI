export interface WatermarkInfo {
  studentId: string;
}

/**
 * Marca de agua dinámica (ADR-008): overlay HTML/CSS + MutationObserver
 * que lo re-inyecta si es removido/alterado.
 */
export function mountWatermark(container: HTMLElement, info: WatermarkInfo): () => void {
  function buildText(): string {
    return `${info.studentId} · ${new Date().toLocaleString()}`;
  }

  function buildOverlay(): HTMLDivElement {
    const overlay = document.createElement("div");
    overlay.className = "watermark-overlay";
    const text = buildText();
    for (let i = 0; i < 15; i += 1) {
      const span = document.createElement("span");
      span.textContent = text;
      overlay.appendChild(span);
    }
    return overlay;
  }

  let overlay = buildOverlay();
  container.appendChild(overlay);

  const observer = new MutationObserver(() => {
    if (!container.contains(overlay)) {
      overlay = buildOverlay();
      container.appendChild(overlay);
    }
  });
  observer.observe(container, { childList: true });

  const refreshTimer = setInterval(() => {
    overlay.querySelectorAll("span").forEach((span) => {
      span.textContent = buildText();
    });
  }, 5000);

  return function unmount(): void {
    clearInterval(refreshTimer);
    observer.disconnect();
    overlay.remove();
  };
}
