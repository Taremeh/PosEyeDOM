// Logging snapshot generation + empty snapshot helper.
(function installLogging() {
  const NS = globalThis.__POSEYEDOM.content;
  const U = NS.utils;

  let lastCoordSig = null;
  let lastCoordAt = 0;

  function resetLocalDedupe() {
    lastCoordSig = null;
    lastCoordAt = 0;
  }

  function sendEmptySnapshot(reason) {
    try {
      if (NS.state.trackingDisabled) return;
      const timestamp = new Date().toISOString();
      const sig = `empty:${String(reason || "unknown")}`;
      resetLocalDedupe();
      U.safeSendMessage({
        type: "log_coordinates",
        data: {
          message: `Forced empty snapshot (${sig})`,
          coordinates: [],
          timestamp,
          signature: sig,
          frame: { top: U.isTopFrame(), href: typeof location !== "undefined" ? location.href : "" },
        },
      });
    } catch (_) {}
  }

  function logDivCoordinates() {
    try {
      if (NS.state.trackingDisabled) return;
      const cfg = NS.state.config || {};
      const viewLines = U.findEditorRoot();
      const divs = viewLines ? viewLines.querySelectorAll(cfg.selectors) : document.querySelectorAll(cfg.selectors);

      const coordinates = Array.from(divs)
        .map((div) => {
          const rect = div.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return null;
          if (!U.isElementVisible(div)) return null;
          const text = div && div.textContent ? String(div.textContent).trim() : "";
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, html: div.outerHTML, text };
        })
        .filter(Boolean);

      const sig = U.buildCoordsSignature(coordinates);
      const now = Date.now();
      if (sig === lastCoordSig && now - lastCoordAt < 300) return;
      lastCoordSig = sig;
      lastCoordAt = now;

      const timestamp = new Date().toISOString();
      U.safeSendMessage({
        type: "log_coordinates",
        data: {
          message: "Div coordinates logged",
          coordinates,
          timestamp,
          signature: sig,
          frame: { top: U.isTopFrame(), href: typeof location !== "undefined" ? location.href : "" },
        },
      });
    } catch (err) {
      const s = err && err.message ? err.message : String(err);
      if (/Extension context invalidated/i.test(s) || /context invalidated/i.test(s)) {
        U.disableTracking("context_invalidated");
        return;
      }
      console.error("Error in logDivCoordinates:", err);
    }
  }

  NS.logging = { logDivCoordinates, sendEmptySnapshot, resetLocalDedupe };
})();


