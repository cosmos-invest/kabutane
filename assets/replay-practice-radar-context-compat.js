(function () {
  "use strict";

  if (typeof HTMLCanvasElement === "undefined") return;

  // replay-practice-coach-v3 historically passes the radar canvas itself to
  // drawRadar(), while buildReport() passes a 2D context. Keep the legacy
  // call safe until the coach module is folded into the next score renderer.
  const prototype = HTMLCanvasElement.prototype;
  const context = (canvas) => {
    try { return canvas.getContext("2d"); } catch (_) { return null; }
  };

  ["save", "restore", "beginPath", "moveTo", "lineTo", "closePath", "stroke", "fill", "arc", "fillText", "measureText"].forEach((name) => {
    if (name in prototype) return;
    Object.defineProperty(prototype, name, {
      configurable: true,
      value: function canvasContextMethod() {
        const ctx = context(this);
        const method = ctx?.[name];
        if (typeof method !== "function") return name === "measureText" ? { width: 0 } : undefined;
        return method.apply(ctx, arguments);
      },
    });
  });

  ["strokeStyle", "fillStyle", "lineWidth", "font", "textAlign", "textBaseline"].forEach((name) => {
    if (name in prototype) return;
    Object.defineProperty(prototype, name, {
      configurable: true,
      get() { return context(this)?.[name]; },
      set(value) {
        const ctx = context(this);
        if (ctx) ctx[name] = value;
      },
    });
  });
})();
