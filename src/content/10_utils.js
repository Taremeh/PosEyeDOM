// Utilities used by other content-script modules.
(function installUtils() {
  const NS = globalThis.__POSEYEDOM.content;
  const state = NS.state;

  function throttle(func, delay) {
    let lastCall = 0;
    return function throttled(...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        func.apply(this, args);
      }
    };
  }

  function disableTracking(reason) {
    if (state.trackingDisabled) return;
    state.trackingDisabled = true;
    try {
      NS.tracking && NS.tracking.stopObserver && NS.tracking.stopObserver();
    } catch (_) {}
    try {
      NS.tracking && NS.tracking.stopActivePoll && NS.tracking.stopActivePoll();
    } catch (_) {}
    try {
      if (NS.tracking && NS.tracking.resetSuggestionState) NS.tracking.resetSuggestionState();
    } catch (_) {}
    try {
      console.warn("[PosEyeDOM] Tracking disabled:", reason || "unknown");
    } catch (_) {}
  }

  function safeSendMessage(msg, cb) {
    if (state.trackingDisabled) return false;
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        disableTracking("runtime_missing");
        return false;
      }
      chrome.runtime.sendMessage(msg, cb);
      return true;
    } catch (e) {
      const s = e && e.message ? e.message : String(e);
      if (/Extension context invalidated/i.test(s) || /context invalidated/i.test(s)) {
        disableTracking("context_invalidated");
        return false;
      }
      try {
        console.warn("[PosEyeDOM] sendMessage failed:", s);
      } catch (_) {}
      return false;
    }
  }

  function isTopFrame() {
    try {
      return window.top === window;
    } catch (_) {
      return true;
    }
  }

  function findEditorRoot() {
    try {
      const a = document.querySelector(".editor-instance");
      if (a) return a;
      const b = document.querySelector(".monaco-editor");
      if (b) return b;
      const c = document.querySelector(".view-lines");
      if (c && c.closest) return c.closest(".monaco-editor") || c.parentElement || c;
    } catch (_) {}
    return null;
  }

  function extractTopPxFromStyle(el) {
    try {
      if (el && el.style && typeof el.style.top === "string" && el.style.top) {
        const v = parseFloat(el.style.top);
        if (Number.isFinite(v)) return v;
      }
    } catch (_) {}
    let s = "";
    try {
      const attr = el && el.getAttribute && el.getAttribute("style");
      if (typeof attr === "string") s = attr;
    } catch (_) {}
    if (s) {
      const m = s.match(/top:\s*([0-9]+(?:\.[0-9]+)?)px/);
      if (m) return Number(m[1]);
    }
    try {
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      const v = cs && cs.top ? parseFloat(cs.top) : NaN;
      if (Number.isFinite(v)) return v;
    } catch (_) {}
    return null;
  }

  function extractLineStyleDetails(el) {
    const out = { top: null, height: null, lineHeight: null };
    try {
      if (el && el.style) {
        if (typeof el.style.top === "string" && el.style.top) {
          const v = parseFloat(el.style.top);
          if (Number.isFinite(v)) out.top = v;
        }
        if (typeof el.style.height === "string" && el.style.height) {
          const v = parseFloat(el.style.height);
          if (Number.isFinite(v)) out.height = v;
        }
        if (typeof el.style.lineHeight === "string" && el.style.lineHeight) {
          const v = parseFloat(el.style.lineHeight);
          if (Number.isFinite(v)) out.lineHeight = v;
        }
      }
    } catch (_) {}
    if (out.top == null || out.height == null || out.lineHeight == null) {
      try {
        const attr = el && el.getAttribute && el.getAttribute("style");
        const s = typeof attr === "string" ? attr : "";
        if (s) {
          if (out.top == null) {
            const m = s.match(/top:\s*([0-9]+(?:\.[0-9]+)?)px/);
            if (m) out.top = Number(m[1]);
          }
          if (out.height == null) {
            const m = s.match(/height:\s*([0-9]+(?:\.[0-9]+)?)px/);
            if (m) out.height = Number(m[1]);
          }
          if (out.lineHeight == null) {
            const m = s.match(/line-height:\s*([0-9]+(?:\.[0-9]+)?)px/);
            if (m) out.lineHeight = Number(m[1]);
          }
        }
      } catch (_) {}
    }
    if (out.top == null || out.height == null || out.lineHeight == null) {
      try {
        const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (cs) {
          if (out.top == null && cs.top) {
            const v = parseFloat(cs.top);
            if (Number.isFinite(v)) out.top = v;
          }
          if (out.height == null && cs.height) {
            const v = parseFloat(cs.height);
            if (Number.isFinite(v)) out.height = v;
          }
          if (out.lineHeight == null && cs.lineHeight) {
            const v = parseFloat(cs.lineHeight);
            if (Number.isFinite(v)) out.lineHeight = v;
          }
        }
      } catch (_) {}
    }
    return out;
  }

  function normalizeText(s) {
    return (s || "").replace(/[\u00A0\s]+/g, "");
  }

  function isElementVisible(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (cs) {
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const op = parseFloat(cs.opacity || "1");
        if (Number.isFinite(op) && op <= 0.05) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildCoordsSignature(coords) {
    try {
      if (!Array.isArray(coords) || coords.length === 0) return "empty";
      const round = (n) => {
        const v = Number(n);
        if (!Number.isFinite(v)) return "NaN";
        return (Math.round(v * 2) / 2).toFixed(1);
      };
      const parts = coords.map((c) => {
        const txt = c && c.text ? String(c.text) : "";
        const t = txt.length > 80 ? txt.slice(0, 80) : txt;
        return `${round(c.x)},${round(c.y)},${round(c.width)},${round(c.height)}:${t}`;
      });
      return `${coords.length}|` + parts.join(";");
    } catch (_) {
      return "sig_err";
    }
  }

  NS.utils = {
    throttle,
    disableTracking,
    safeSendMessage,
    isTopFrame,
    findEditorRoot,
    extractTopPxFromStyle,
    extractLineStyleDetails,
    normalizeText,
    isElementVisible,
    buildCoordsSignature,
  };
})();


