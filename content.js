// Utility: Throttle a function so it’s invoked at most once every delay milliseconds.
function throttle(func, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func.apply(this, args);
    }
  };
}

// --- Runtime safety: avoid noisy "Extension context invalidated" spam after reloads ---
let TRACKING_DISABLED = false;
function disableTracking(reason) {
  if (TRACKING_DISABLED) return;
  TRACKING_DISABLED = true;
  try { stopObserver(); } catch (_) {}
  try { stopActivePoll(); } catch (_) {}
  try {
    if (SUGG_STATE && SUGG_STATE.compareTimer) { clearTimeout(SUGG_STATE.compareTimer); SUGG_STATE.compareTimer = null; }
    SUGG_STATE.active = false;
    SUGG_STATE.lines = new Map();
    SUGG_STATE.lastSeenAt = 0;
    SUGG_STATE.lastEmptyAt = 0;
  } catch (_) {}
  try { console.warn("[PosEyeDOM] Tracking disabled:", reason || "unknown"); } catch (_) {}
}

function safeSendMessage(msg, cb) {
  if (TRACKING_DISABLED) return false;
  try {
    // If runtime is missing, extension context is gone.
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
      disableTracking("runtime_missing");
      return false;
    }
    chrome.runtime.sendMessage(msg, cb);
    return true;
  } catch (e) {
    const s = (e && e.message) ? e.message : String(e);
    if (/Extension context invalidated/i.test(s) || /context invalidated/i.test(s)) {
      disableTracking("context_invalidated");
      return false;
    }
    // Other errors: keep existing behavior but don't crash.
    try { console.warn("[PosEyeDOM] sendMessage failed:", s); } catch (_) {}
    return false;
  }
}

// --- IA/HTML computation (ported from your Python script) ---
// Simple and readable implementation.
(function attachIAComputerOnContent() {
  function getWindowOffset() {
    try {
      if (typeof CONFIG !== 'undefined' && CONFIG.browserWindowOffset != null) {
        return Math.max(0, Number(CONFIG.browserWindowOffset));
      }
    } catch (_) {}
    return 91;
  }

  function parseISO(ts) {
    // Robust ISO parsing; returns Date or null
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }

  function assignLabel(baseKey, currentPos, labelState) {
    // labelState: { [baseKey]: { baseLabel, lastPos, nextSuffix } }
    let info = labelState[baseKey];
    if (!info) {
      const baseLabel = `autolabel_${labelState._counter}`;
      labelState._counter += 1;
      info = { baseLabel, lastPos: null, nextSuffix: 1 };
      labelState[baseKey] = info;
    }
    let label;
    if (info.lastPos === currentPos) {
      label = info.baseLabel;
    } else {
      if (info.lastPos === null) {
        label = info.baseLabel;
      } else {
        label = `${info.baseLabel}_${info.nextSuffix}`;
        info.nextSuffix += 1;
      }
      info.lastPos = currentPos;
    }
    return label;
  }

  function flushUnusedBaseLabels(activeRecords, labelState) {
    const activeBases = new Set(Array.from(activeRecords.keys()).map(k => k.split("::")[0]));
    Object.keys(labelState).forEach(base => {
      if (base === "_counter") return;
      if (!activeBases.has(base)) delete labelState[base];
    });
  }

  // Core computation: takes raw logs, returns { iasText, htmlMapping }
  function computeIAFromLogs(logs, opts = {}) {
    try {
      const offsetMsInput = Number(opts.offsetMs || 0);
      const windowOffset = Number.isFinite(opts.browserWindowOffset)
        ? Math.max(0, Number(opts.browserWindowOffset))
        : getWindowOffset();

      // sort logs by outer timestamp (background saved ISO string at entry.timestamp)
      const ordered = [...(logs || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // If no logs at all, return empty header + mapping
      if (ordered.length === 0) {
        return {
          iasText: "# IA\tstart_time\tend_time\tshape\tID\tx\ty\tright\tbottom\tlabel\n",
          htmlMapping: {}
        };
      }

      // Try to find the initial 's' key press reference
      const ipEntry = ordered.find(
        e => e && e.coordinates && e.coordinates.message === "First 's' key press logged"
      );

      // Establish baseline epoch
      let baseEpochMs;
      if (ipEntry) {
        const ipTime = parseISO(ipEntry.coordinates.timestamp);
        if (!ipTime) {
          console.warn("Invalid 's' keypress timestamp. Falling back to first log timestamp with no offset.");
          const firstTs = parseISO(ordered[0].timestamp);
          if (!firstTs) throw new Error("No valid timestamps in logs.");
          baseEpochMs = firstTs.getTime(); // ignore offset when falling back
        } else {
          baseEpochMs = ipTime.getTime() - offsetMsInput; // use offset only when 's' exists
        }
      } else {
        console.warn("No 's' key press found. Using first log timestamp as baseline with no offset.");
        const firstTs = parseISO(ordered[0].timestamp);
        if (!firstTs) throw new Error("No valid timestamps in logs.");
        baseEpochMs = firstTs.getTime(); // ignore offset when no 's'
      }

      const toRelativeMs = (ts) => {
        const d = parseISO(ts);
        if (!d) throw new Error(`Invalid log timestamp: ${ts}`);
        return Math.max(0, Math.floor(d.getTime() - baseEpochMs));
      };

      const activeRecords = new Map(); // key -> rec
      const labelState = { _counter: 1 }; // per baseKey state
      const iaData = []; // finalized records
      const htmlMapping = {}; // label -> html
      let nextId = 1;
      let lastCoordIso = null;

      for (const entry of ordered) {
        const isCoordLog = entry && entry.coordinates && Array.isArray(entry.coordinates.coordinates);
        if (!isCoordLog) { continue; }
        const currentMs = toRelativeMs(entry.timestamp);
        const coordsWrap = entry.coordinates.coordinates || [];
        const coords = coordsWrap.filter(c => c && c.width && c.height);
        const seenKeys = new Set();

        if (!coords || coords.length === 0) {
          // Close all active if nothing is visible in this frame
          for (const [key, rec] of Array.from(activeRecords.entries())) {
            rec.end = currentMs;
            iaData.push(rec);
            activeRecords.delete(key);
          }
          flushUnusedBaseLabels(activeRecords, labelState);
          lastCoordIso = entry.timestamp;
          continue;
        }

        // Multiple elements: merge vertically and compute bounding box
        if (coords.length > 1) {
          const __OFF = windowOffset;
          const sorted = [...coords].sort((a, b) => (a.y + __OFF) - (b.y + __OFF));
          let mergedHtml = "";
          const ys = [], xs = [], rights = [], bottoms = [];
          let lastY = null;
          for (const c of sorted) {
            const x = c.x;
            const y = c.y + __OFF;
            if (lastY !== null && y > lastY) mergedHtml += "\n";
            mergedHtml += c.html;
            lastY = y;
            ys.push(y);
            xs.push(x);
            rights.push(x + (c.width || 0));
            bottoms.push(y + (c.height || 0));
          }
          const baseKey = `multi|${mergedHtml}`;
          const posKey = `ys|${ys.join(',')}`;
          const fullKey = `${baseKey}::${posKey}`;
          seenKeys.add(fullKey);

          const label = assignLabel(baseKey, posKey, labelState);
          if (!activeRecords.has(fullKey)) {
            const hM = Number.isFinite(opts.errorMarginH) ? Math.max(0, Number(opts.errorMarginH)) : Math.max(0, Number((typeof CONFIG !== 'undefined' && CONFIG.errorMarginH != null) ? CONFIG.errorMarginH : 0));
            const vM = Number.isFinite(opts.errorMarginV) ? Math.max(0, Number(opts.errorMarginV)) : Math.max(0, Number((typeof CONFIG !== 'undefined' && CONFIG.errorMarginV != null) ? CONFIG.errorMarginV : 0));
            const x0 = Math.min(...xs) - hM;
            const y0 = Math.min(...ys) - vM;
            const r0 = Math.max(...rights) + hM;
            const b0 = Math.max(...bottoms) + vM;
            const rec = {
              start: currentMs,
              end: currentMs,
              id: nextId++,
              label,
              html: mergedHtml,
              x: x0,
              y: y0,
              right: r0,
              bottom: b0,
            };
            activeRecords.set(fullKey, rec);
            htmlMapping[label] = mergedHtml;
          } else {
            activeRecords.get(fullKey).end = currentMs;
          }
        } else {
          // Single element case
          const c = coords[0];
          const x = c.x;
          const y = c.y + windowOffset;
          const mergedHtml = c.html;
          const baseKey = `single|${mergedHtml}|wh|${c.width}x${c.height}`;
          const posKey = `y|${y}`;
          const fullKey = `${baseKey}::${posKey}`;
          seenKeys.add(fullKey);

          const label = assignLabel(baseKey, posKey, labelState);
          if (!activeRecords.has(fullKey)) {
            const hM = Number.isFinite(opts.errorMarginH) ? Math.max(0, Number(opts.errorMarginH)) : Math.max(0, Number((typeof CONFIG !== 'undefined' && CONFIG.errorMarginH != null) ? CONFIG.errorMarginH : 0));
            const vM = Number.isFinite(opts.errorMarginV) ? Math.max(0, Number(opts.errorMarginV)) : Math.max(0, Number((typeof CONFIG !== 'undefined' && CONFIG.errorMarginV != null) ? CONFIG.errorMarginV : 0));
            const xAdj = x - hM;
            const yAdj = y - vM;
            const rightAdj = x + (c.width || 0) + hM;
            const bottomAdj = y + (c.height || 0) + vM;
            const rec = {
              start: currentMs,
              end: currentMs,
              id: nextId++,
              label,
              html: mergedHtml,
              x: xAdj,
              y: yAdj,
              right: rightAdj,
              bottom: bottomAdj,
            };
            activeRecords.set(fullKey, rec);
            htmlMapping[label] = mergedHtml;
          } else {
            activeRecords.get(fullKey).end = currentMs;
          }
        }

        // Close any records not seen in this frame
        for (const [key, rec] of Array.from(activeRecords.entries())) {
          if (!seenKeys.has(key)) {
            rec.end = currentMs;
            iaData.push(rec);
            activeRecords.delete(key);
          }
        }
        flushUnusedBaseLabels(activeRecords, labelState);
        lastCoordIso = entry.timestamp;
      }

      // finalize
      const finalMs = lastCoordIso ? toRelativeMs(lastCoordIso) : 0;
      for (const rec of activeRecords.values()) {
        rec.end = finalMs;
        iaData.push(rec);
      }

      // Build IAS (same format as your Python generator)
      let iasText = "# IA\tstart_time\tend_time\tshape\tID\tx\ty\tright\tbottom\tlabel\n";
      for (const rec of iaData) {
        iasText += `-${rec.start}\t-${rec.end}\tRECTANGLE\t${rec.id}\t${rec.x.toFixed(2)}\t${rec.y.toFixed(2)}\t${rec.right.toFixed(2)}\t${rec.bottom.toFixed(2)}\t${rec.label}\n`;
      }

      return { iasText, htmlMapping };
    } catch (err) {
      console.error("IA computation error:", err);
      throw err;
    }
  }

  // Expose a message endpoint so the popup can ask this content script to compute IA/HTML.
  // The popup will pass the raw logs; content.js does the merge.
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === "compute_ia_html_from_logs") {
        try {
          const { logs, offsetMs, errorMarginH, errorMarginV, browserWindowOffset } = message;
          const out = computeIAFromLogs(Array.isArray(logs) ? logs : [], { offsetMs, errorMarginH, errorMarginV, browserWindowOffset });
          sendResponse({ ok: true, ...out });
        } catch (e) {
          sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        }
        return true; // async response
      }
    });
  } catch (err) {
    console.error("Failed to attach compute_ia_html_from_logs listener:", err);
  }
})();

// Configuration with defaults, loaded from chrome.storage.sync
let CONFIG = {
  selectors: ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview",
  syncKey: "s",
  remoteUrl: "",
  errorMarginH: 44,
  errorMarginV: 22
};

// --- Frame / dedupe helpers ---
function isTopFrame() {
  try { return window.top === window; } catch (_) { return true; }
}

function findEditorRoot() {
  try {
    // Prefer the stable wrapper used by github.dev
    const a = document.querySelector(".editor-instance");
    if (a) return a;
    // Fallbacks for Monaco/VS Code web layouts
    const b = document.querySelector(".monaco-editor");
    if (b) return b;
    const c = document.querySelector(".view-lines");
    if (c && c.closest) return c.closest(".monaco-editor") || c.parentElement || c;
  } catch (_) {}
  return null;
}

let LAST_COORD_SIG = null;
let LAST_COORD_AT = 0;

function buildCoordsSignature(coords) {
  // Compact signature to dedupe repeat snapshots; avoid hashing huge HTML.
  try {
    if (!Array.isArray(coords) || coords.length === 0) return "empty";
    const round = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return "NaN";
      return (Math.round(v * 2) / 2).toFixed(1); // 0.5px precision
    };
    const parts = coords.map(c => {
      const txt = (c && c.text) ? String(c.text) : "";
      const t = txt.length > 80 ? txt.slice(0, 80) : txt;
      return `${round(c.x)},${round(c.y)},${round(c.width)},${round(c.height)}:${t}`;
    });
    return `${coords.length}|` + parts.join(";");
  } catch (_) {
    return "sig_err";
  }
}

function loadConfig(callback) {
  try {
    chrome.storage.sync.get({ ...CONFIG, throttleMs: 200, browserWindowOffset: 91, errorMarginH: 44, errorMarginV: 22 }, (cfg) => {
      CONFIG = { ...CONFIG, ...cfg };
      try { if (typeof callback === 'function') callback(CONFIG); } catch (_) {}
    });
  } catch (e) { /* ignore */ }
}

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "settings_updated") {
      const incoming = (message && message.data) ? message.data : null;
      if (incoming && typeof incoming === 'object') {
        try {
          CONFIG = { ...CONFIG, ...incoming };
        } catch (_) {}
      }
      loadConfig(() => {
        try { refreshThrottle(); } catch (_) {}
        // Reset suggestion detection state
        try {
          if (SUGG_STATE && SUGG_STATE.compareTimer) { clearTimeout(SUGG_STATE.compareTimer); SUGG_STATE.compareTimer = null; }
          SUGG_STATE.active = false;
          SUGG_STATE.lines = new Map();
          SUGG_STATE.lastSeenAt = 0;
          SUGG_STATE.lastEmptyAt = 0;
        } catch (_) {}
        // Re-apply tracking instantly with new selectors/throttle
        try { stopObserver(); } catch (_) {}
        try { startObserver(); } catch (_) {}
        try { detectSuggestionAcceptance(); } catch (_) {}
        try { logDivCoordinates(); } catch (_) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (_) {}
      });
      return true; // async response
    } else if (message && message.type === "force_reattach") {
      // Manual repair: restart observer + detection (similar to a page reload / script reinjection).
      loadConfig(() => {
        try { refreshThrottle(); } catch (_) {}
        try { stopObserver(); } catch (_) {}
        try { startObserver(); } catch (_) {}
        try { detectSuggestionAcceptance(); } catch (_) {}
        try { logDivCoordinates(); } catch (_) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (_) {}
      });
      return true; // async response
    }
  });
} catch (e) { /* ignore */ }

loadConfig();

// Logs coordinates and outerHTML for divs with the specified classes.
function logDivCoordinates() {
  try {
    if (TRACKING_DISABLED) return;
    const viewLines = findEditorRoot();
    const divs = viewLines
      ? viewLines.querySelectorAll(CONFIG.selectors)
      : document.querySelectorAll(CONFIG.selectors);

    const coordinates = Array.from(divs).map(div => {
      const rect = div.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      if (!isElementVisible(div)) return null;
      const text = (div && div.textContent) ? String(div.textContent).trim() : "";
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        html: div.outerHTML,
        text
      };
    }).filter(Boolean);

    // Dedupe identical snapshots in this frame (common during bursty mutations)
    const sig = buildCoordsSignature(coordinates);
    const now = Date.now();
    if (sig === LAST_COORD_SIG && (now - LAST_COORD_AT) < 300) {
      return;
    }
    LAST_COORD_SIG = sig;
    LAST_COORD_AT = now;

    const timestamp = new Date().toISOString();
    console.log("Logged div coordinates:", coordinates, "Timestamp:", timestamp);

    // Send the log to the background script
    safeSendMessage({
      type: "log_coordinates",
      data: {
        message: "Div coordinates logged",
        coordinates: coordinates,
        timestamp: timestamp,
        signature: sig,
        frame: { top: isTopFrame(), href: (typeof location !== "undefined" ? location.href : "") }
      }
    });
  } catch (err) {
    const s = (err && err.message) ? err.message : String(err);
    if (/Extension context invalidated/i.test(s) || /context invalidated/i.test(s)) {
      disableTracking("context_invalidated");
      return;
    }
    console.error("Error in logDivCoordinates:", err);
  }
}

// Global variables for the MutationObserver and its status.
let observer = null;
let observerActive = false;
let observerRoot = null;

// Create a throttled version of logDivCoordinates using configurable delay
let throttledLogDivCoordinates = throttle(logDivCoordinates, 200);
function refreshThrottle() {
  const delay = Math.max(0, Number((typeof CONFIG !== 'undefined' && CONFIG.throttleMs != null) ? CONFIG.throttleMs : 200));
  throttledLogDivCoordinates = throttle(logDivCoordinates, delay);
}
refreshThrottle();

// Suggestion acceptance detection state and helpers
const GHOST_CLASSES = ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview";
let SUGG_STATE = { active: false, lines: new Map(), lastSeenAt: 0, compareTimer: null, lastEmptyAt: 0 };
let ACTIVE_POLL_TIMER = null;

function sendEmptySnapshot(reason) {
  try {
    if (TRACKING_DISABLED) return;
    const timestamp = new Date().toISOString();
    const sig = `empty:${String(reason || "unknown")}`;
    // Reset local dedupe so this empty snapshot isn't dropped due to prior empties.
    try { LAST_COORD_SIG = null; LAST_COORD_AT = 0; } catch (_) {}
    safeSendMessage({
      type: "log_coordinates",
      data: {
        message: `Forced empty snapshot (${sig})`,
        coordinates: [],
        timestamp,
        signature: sig,
        frame: { top: isTopFrame(), href: (typeof location !== "undefined" ? location.href : "") }
      }
    });
  } catch (_) {}
}

function ensureActivePoll() {
  if (ACTIVE_POLL_TIMER) return;
  // Some dismissals (e.g. ESC) can hide ghosts with minimal DOM churn; poll lightly while active.
  ACTIVE_POLL_TIMER = setInterval(() => {
    try {
      if (!SUGG_STATE.active) return;
      detectSuggestionAcceptance();
      throttledLogDivCoordinates();
    } catch (_) {}
  }, 250);
}

function stopActivePoll() {
  if (!ACTIVE_POLL_TIMER) return;
  try { clearInterval(ACTIVE_POLL_TIMER); } catch (_) {}
  ACTIVE_POLL_TIMER = null;
}

function forceRejectOnFocusLoss(reason) {
  // Requirement: when leaving/unfocusing, treat the current visible suggestion as rejected at that moment.
  try {
    sendEmptySnapshot(reason || "focus_loss");
  } catch (_) {}
  try {
    // Clear acceptance detection state immediately so it doesn't "finish" later with a bad timestamp.
    if (SUGG_STATE && SUGG_STATE.compareTimer) { try { clearTimeout(SUGG_STATE.compareTimer); } catch (_) {} SUGG_STATE.compareTimer = null; }
    SUGG_STATE.active = false;
    SUGG_STATE.lines = new Map();
    SUGG_STATE.lastSeenAt = 0;
    SUGG_STATE.lastEmptyAt = 0;
  } catch (_) {}
  try { stopActivePoll(); } catch (_) {}
}

function extractTopPxFromStyle(el) {
  // Try inline style object first
  try {
    if (el && el.style && typeof el.style.top === 'string' && el.style.top) {
      const v = parseFloat(el.style.top);
      if (Number.isFinite(v)) return v;
    }
  } catch (_) {}
  // Fallback to style attribute string
  let s = "";
  try {
    const attr = el && el.getAttribute && el.getAttribute("style");
    if (typeof attr === 'string') s = attr;
  } catch (_) {}
  if (s) {
    const m = s.match(/top:\s*([0-9]+(?:\.[0-9]+)?)px/);
    if (m) return Number(m[1]);
  }
  // Last resort: computed style
  try {
    const cs = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(el) : null;
    const v = cs && cs.top ? parseFloat(cs.top) : NaN;
    if (Number.isFinite(v)) return v;
  } catch (_) {}
  return null;
}

function extractLineStyleDetails(el) {
  const out = { top: null, height: null, lineHeight: null };
  try {
    // Prefer inline style object
    if (el && el.style) {
      if (typeof el.style.top === 'string' && el.style.top) {
        const v = parseFloat(el.style.top); if (Number.isFinite(v)) out.top = v;
      }
      if (typeof el.style.height === 'string' && el.style.height) {
        const v = parseFloat(el.style.height); if (Number.isFinite(v)) out.height = v;
      }
      if (typeof el.style.lineHeight === 'string' && el.style.lineHeight) {
        const v = parseFloat(el.style.lineHeight); if (Number.isFinite(v)) out.lineHeight = v;
      }
    }
  } catch (_) {}
  // Fallback to style attribute
  if (out.top == null || out.height == null || out.lineHeight == null) {
    try {
      const attr = el && el.getAttribute && el.getAttribute("style");
      const s = typeof attr === 'string' ? attr : "";
      if (s) {
        if (out.top == null) { const m = s.match(/top:\s*([0-9]+(?:\.[0-9]+)?)px/); if (m) out.top = Number(m[1]); }
        if (out.height == null) { const m = s.match(/height:\s*([0-9]+(?:\.[0-9]+)?)px/); if (m) out.height = Number(m[1]); }
        if (out.lineHeight == null) { const m = s.match(/line-height:\s*([0-9]+(?:\.[0-9]+)?)px/); if (m) out.lineHeight = Number(m[1]); }
      }
    } catch (_) {}
  }
  // Computed style as final fallback
  if (out.top == null || out.height == null || out.lineHeight == null) {
    try {
      const cs = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(el) : null;
      if (cs) {
        if (out.top == null && cs.top) { const v = parseFloat(cs.top); if (Number.isFinite(v)) out.top = v; }
        if (out.height == null && cs.height) { const v = parseFloat(cs.height); if (Number.isFinite(v)) out.height = v; }
        if (out.lineHeight == null && cs.lineHeight) { const v = parseFloat(cs.lineHeight); if (Number.isFinite(v)) out.lineHeight = v; }
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

function collectGhostLines() {
  try {
    const root = document.querySelector(".editor-instance") || document;
    const lines = Array.from(root.querySelectorAll(".view-line"));
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      const lineEl = lines[i];
      // Treat "dismissed" suggestions as absent when ghost elements are hidden (opacity/display)
      let hasGhost = false;
      try {
        const ghosts = lineEl.querySelectorAll(CONFIG.selectors);
        hasGhost = Array.from(ghosts).some(isElementVisible);
      } catch (_) { hasGhost = false; }
      if (!hasGhost) continue;
      const isPreview = !!lineEl.closest(".suggest-preview-text");
      if (isPreview) continue; // anchor must be a non-preview line with ghosts
      const det = extractLineStyleDetails(lineEl);
      if (det.top == null) continue;
      let combined = "";
      try {
        const ghostsInLine = lineEl.querySelectorAll(CONFIG.selectors);
        combined = Array.from(ghostsInLine).filter(isElementVisible).map(el => el.textContent || "").join("");
      } catch (_) {
        combined = lineEl.textContent || "";
      }
      // Append consecutive preview lines' ghost text
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const inPreview = !!nextLine.closest(".suggest-preview-text");
        if (!inPreview) break;
        let nextHasGhost = false;
        try {
          const ghosts = nextLine.querySelectorAll(CONFIG.selectors);
          nextHasGhost = Array.from(ghosts).some(isElementVisible);
        } catch (_) { nextHasGhost = false; }
        if (!nextHasGhost) break;
        try {
          const ghostsInNext = nextLine.querySelectorAll(CONFIG.selectors);
          const t = Array.from(ghostsInNext).filter(isElementVisible).map(el => el.textContent || "").join("");
          combined += "\n" + t;
        } catch (_) {
          combined += "\n" + (nextLine.textContent || "");
        }
        j += 1;
      }
      blocks.push({ top: det.top, height: det.height, lineHeight: det.lineHeight, snapshotText: combined, snapshotNorm: normalizeText(combined) });
    }

    // Fallback: preview-only suggestions (no non-preview anchor yet)
    if (blocks.length === 0) {
      const previews = Array.from(root.querySelectorAll('.suggest-preview-text'));
      previews.forEach((pv) => {
        try {
          // Gather preview child lines with ghosts only
          const childLines = Array.from(pv.querySelectorAll('.view-line')).filter(el => {
            try {
              const ghosts = el.querySelectorAll(CONFIG.selectors);
              return Array.from(ghosts).some(isElementVisible);
            } catch (_) { return false; }
          });
          if (childLines.length === 0) return;
          const combined = childLines.map(pl => {
            try {
              const ghosts = pl.querySelectorAll(CONFIG.selectors);
              return Array.from(ghosts).filter(isElementVisible).map(el => el.textContent || '').join('');
            } catch (_) { return pl.textContent || ''; }
          }).join('\n');

          // Anchor: nearest non-preview .view-line above the preview container
          const y = (pv.getBoundingClientRect && pv.getBoundingClientRect()) ? pv.getBoundingClientRect().top : 0;
          const realLines = lines.filter(el => !el.closest('.suggest-preview-text'));
          let best = null; let bestDy = Infinity;
          realLines.forEach(el => {
            try {
              const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
              const dy = (r ? (y - r.top) : Infinity);
              if (dy >= -4 && dy < bestDy) { // prefer just above or overlapping within small epsilon
                bestDy = dy; best = el;
              }
            } catch (_) {}
          });
          if (!best && realLines.length > 0) best = realLines[0];
          const detA = best ? extractLineStyleDetails(best) : { top: 0, height: null, lineHeight: null };
          const topA = detA.top != null ? detA.top : 0;
          blocks.push({ top: topA, height: detA.height, lineHeight: detA.lineHeight, snapshotText: combined, snapshotNorm: normalizeText(combined) });
          try { console.log('[Acceptance] preview-only snapshot anchored', { anchorTop: topA, previewLines: childLines.length, len: combined.length }); } catch (_) {}
        } catch (_) { /* ignore this preview block */ }
      });
    }

    return blocks;
  } catch (_) {
    return [];
  }
}

function collectDownwardTextFromTop(topStart, lineHeightHint) {
  // Gather text starting from the line nearest to topStart, then following lines
  try {
    const lines = Array.from(document.querySelectorAll(".view-line"));
    const entries = lines.map(el => ({ el, top: extractTopPxFromStyle(el), det: extractLineStyleDetails(el) }))
                         .filter(e => e.top != null)
                         .sort((a,b)=>a.top - b.top);
    if (entries.length === 0) return "";
    const EPS = 1.0; // px tolerance
    let startIdx = entries.findIndex(e => Math.abs(e.top - topStart) <= EPS);
    if (startIdx === -1) {
      // choose the first entry with top >= topStart - EPS, else index 0
      startIdx = entries.findIndex(e => e.top >= (topStart - EPS));
      if (startIdx === -1) startIdx = 0;
    }
    const startLH = (typeof lineHeightHint === 'number' && lineHeightHint > 0)
      ? lineHeightHint
      : (entries[startIdx].det.lineHeight || entries[startIdx].det.height || 27);
    let out = "";
    let lastTop = null;
    for (let i = startIdx; i < entries.length && i < startIdx + 20; i++) {
      const cur = entries[i];
      if (lastTop != null) {
        const gap = cur.top - lastTop;
        if (gap > (startLH * 2.2)) break;
      }
      lastTop = cur.top;
      out += (cur.el.textContent || "") + "\n";
    }
    return out;
  } catch (_) {
    return "";
  }
}

function runAcceptanceCompare() {
  // Abort if ghosts are present again
  try {
    const still = collectGhostLines();
    if (still && still.length > 0) {
      console.log("[Acceptance] compare aborted; ghosts visible again", still.length);
      SUGG_STATE.compareTimer = null;
      return;
    }
  } catch (_) {}
  if (!(SUGG_STATE.active && SUGG_STATE.lines && SUGG_STATE.lines.size > 0)) return;
  console.log("[Acceptance] ghosts disappeared, running comparison for", SUGG_STATE.lines.size, "anchor(s)");
  let anyOk = false;
  let bestIdx = null;
  let bestTop = null;
  let totalAnchors = 0;
  const linesForLog = [];

  const MAX_MATCH_PREFIX_CHARS = 1200;

  SUGG_STATE.lines.forEach((v) => {
    totalAnchors += 1;
    const combinedCurrent = collectDownwardTextFromTop(v.top, v.lineHeight);
    const expectedNorm = String(v.snapshotNorm || "");
    linesForLog.push({ top: v.top, expectedText: v.snapshotText, nowText: combinedCurrent });

    const nowNorm = normalizeText(combinedCurrent);
    const idx = expectedNorm ? nowNorm.indexOf(expectedNorm) : -1;
    const ok = idx >= 0 && idx < Math.min(nowNorm.length, MAX_MATCH_PREFIX_CHARS);
    if (ok) {
      anyOk = true;
      if (bestIdx === null || idx < bestIdx) { bestIdx = idx; bestTop = v.top; }
    }
    try {
      const trunc = (s) => (s.length > 240 ? s.slice(0, 240) + `... (${s.length} chars)` : s + ` (${s.length} chars)`);
      console.log("[AcceptanceCheck] top=", v.top,
        "\nexpectedRaw=\n", trunc(v.snapshotText || ""),
        "\ncurrentRaw=\n", trunc(combinedCurrent || ""),
        "\nexpectedNorm=\n", trunc(expectedNorm),
        "\nindex=", idx, " match=", ok);
      // Emit event for background consumption (both true and false)
      try {
        safeSendMessage({ type: "log_acceptance_check", data: { top: v.top, ok, idx, detectedAt: new Date().toISOString(), expectedText: v.snapshotText, nowText: combinedCurrent } });
      } catch(_) {}
    } catch (_) {}
  });

  const accepted = anyOk;

  if (accepted) {
    try {
      safeSendMessage({
        type: "log_acceptance",
        data: {
          message: "Suggestion accepted",
          lines: linesForLog,
          seenAt: SUGG_STATE.lastSeenAt,
          detectedAt: new Date().toISOString(),
          decision: { bestTop, bestIdx, totalAnchors, rule: { maxMatchPrefixChars: MAX_MATCH_PREFIX_CHARS } }
        }
      });
      console.log("[Acceptance] accepted=true", { bestTop, bestIdx, totalAnchors });
    } catch (e) { /* ignore */ }
  } else {
    console.log("[Acceptance] accepted=false", { totalAnchors });
  }
  SUGG_STATE.active = false;
  stopActivePoll();
  SUGG_STATE.lines = new Map();
  SUGG_STATE.lastSeenAt = 0;
  SUGG_STATE.compareTimer = null;
}

function detectSuggestionAcceptance() {
  try {
    const ghosts = collectGhostLines();
    if (ghosts.length > 0) {
      const firstActivate = !SUGG_STATE.active;
      const newMap = new Map();
      ghosts.forEach(g => { newMap.set(`top:${g.top}`, { top: g.top, height: g.height, lineHeight: g.lineHeight, snapshotText: g.snapshotText, snapshotNorm: g.snapshotNorm }); });
      SUGG_STATE.active = true;
      ensureActivePoll();
      SUGG_STATE.lines = newMap;
      SUGG_STATE.lastSeenAt = Date.now();
      SUGG_STATE.lastEmptyAt = 0;
      if (SUGG_STATE.compareTimer) { try { clearTimeout(SUGG_STATE.compareTimer); } catch (_) {} SUGG_STATE.compareTimer = null; }
      if (firstActivate) {
        try { console.log("[Acceptance] snapshot captured", Array.from(newMap.values()).map(v => ({ top: v.top, len: (v.snapshotText||"").length }))); } catch (_) {}
      }
      return;
    }
    if (SUGG_STATE.active && SUGG_STATE.lines && SUGG_STATE.lines.size > 0) {
      const now = Date.now();
      if (!SUGG_STATE.lastEmptyAt) SUGG_STATE.lastEmptyAt = now;
      const stableMs = now - SUGG_STATE.lastEmptyAt;
      // Defer compare until absence has been stable for >= 150ms
      if (!SUGG_STATE.compareTimer && stableMs >= 150) {
        SUGG_STATE.compareTimer = setTimeout(() => {
          try { requestAnimationFrame(() => runAcceptanceCompare()); } catch (_) { runAcceptanceCompare(); }
        }, 0);
        console.log("[Acceptance] ghosts disappeared, scheduled compare (stable)");
      } else if (!SUGG_STATE.compareTimer) {
        // schedule a check later to see if stable
        SUGG_STATE.compareTimer = setTimeout(() => {
          SUGG_STATE.compareTimer = null;
          detectSuggestionAcceptance();
        }, 160 - stableMs);
        console.log("[Acceptance] awaiting stable absence", stableMs, "ms");
      }
    } else {
      stopActivePoll();
      SUGG_STATE.lastEmptyAt = 0;
    }
  } catch (err) {
    console.error("detectSuggestionAcceptance error", err);
  }
}

// Force a state check on ESC to catch dismissals that hide ghosts without obvious DOM mutations.
try {
  window.addEventListener("keydown", (e) => {
    try {
      if (!e || e.key !== "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // If a suggestion was active (or is currently visible), force a detection + snapshot.
      setTimeout(() => {
        try { detectSuggestionAcceptance(); } catch (_) {}
        try { logDivCoordinates(); } catch (_) {}
      }, 0);
    } catch (_) {}
  }, { capture: true });
} catch (_) {}

// If we leave the editor/tab/window, ghost suggestions can disappear due to CSS focus state without any DOM mutation.
// MutationObserver doesn't fire on "visual-only" changes, so we force-close the suggestion at blur/hidden time.
try {
  window.addEventListener("blur", () => {
    try { forceRejectOnFocusLoss("window_blur"); } catch (_) {}
  }, { capture: true });
} catch (_) {}

try {
  document.addEventListener("visibilitychange", () => {
    try {
      if (document.hidden) forceRejectOnFocusLoss("document_hidden");
    } catch (_) {}
  }, { capture: true });
} catch (_) {}

// Callback for the MutationObserver.
function observerCallback(mutationsList, observer) {
  // Only react to mutations likely related to ghost suggestions to reduce noise/overhead.
  let relevant = false;
  try {
    const sel = CONFIG && CONFIG.selectors ? CONFIG.selectors : GHOST_CLASSES;
    for (const m of (mutationsList || [])) {
      if (!m) continue;
      if (m.type === "childList") {
        const scan = (node) => {
          try {
            if (!node) return false;
            if (node.nodeType === 1) {
              const el = node;
              if (el.matches && el.matches(sel)) return true;
              if (el.closest && el.closest(".suggest-preview-text")) return true;
              if (el.querySelector && (el.querySelector(sel) || el.querySelector(".suggest-preview-text"))) return true;
            }
          } catch (_) {}
          return false;
        };
        for (const n of Array.from(m.addedNodes || [])) { if (scan(n)) { relevant = true; break; } }
        if (!relevant) for (const n of Array.from(m.removedNodes || [])) { if (scan(n)) { relevant = true; break; } }
      } else if (m.type === "attributes") {
        const t = m.target;
        try {
          if (t && t.matches && (t.matches(sel) || t.closest(".suggest-preview-text"))) { relevant = true; }
          else if (t && t.querySelector && (t.querySelector(sel) || t.querySelector(".suggest-preview-text"))) { relevant = true; }
        } catch (_) {}
      } else if (m.type === "characterData") {
        // Ghost text changes can be characterData on a Text node inside the ghost element
        try {
          const p = m.target && m.target.parentElement;
          if (p && p.closest && p.closest(".ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview, .suggest-preview-text")) relevant = true;
        } catch (_) {}
      }
      if (relevant) break;
    }
  } catch (_) {}

  if (!relevant) return;
  detectSuggestionAcceptance();
  throttledLogDivCoordinates();
}

// Starts the MutationObserver on the .editor-instance element.
function startObserver() {
  // If we have an observer but the root was replaced/disconnected, restart it.
  try {
    if (observer && observerRoot && observerRoot.isConnected === false) {
      stopObserver();
    }
  } catch (_) {}

  const root = findEditorRoot();
  if (!root) {
    // No editor yet; keep observer stopped.
    stopObserver();
    return;
  }

  // If already observing the current root, do nothing.
  if (observer && observerRoot === root) {
    observerActive = true;
    return;
  }

  // Otherwise restart on the new root.
  stopObserver();
  observerRoot = root;
  observer = new MutationObserver(observerCallback);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style"],
    childList: true,
    subtree: true,
    characterData: true
  });
  observerActive = true;
}

// Stops the MutationObserver.
function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
    observerActive = false;
    observerRoot = null;
    console.log("Observer stopped.");
  } else {
    console.log("Observer is not running.");
  }
}

// Only run on pages with a hostname ending with "github.dev"
if (window.location.hostname.endsWith('github.dev')) {
  // Every 10 seconds, ensure the observer is running.
  setInterval(() => {
    // Keep this quiet; it's purely a watchdog.
    try { startObserver(); } catch (err) { console.error("Error starting observer:", err); }
  }, 10000);

  // Every 10 seconds, request the complete DB content and POST it.
  setInterval(() => {
    try {
      // Avoid accidental fetch("") / spam when remoteUrl is not configured.
      const url = (CONFIG && typeof CONFIG.remoteUrl === "string") ? CONFIG.remoteUrl.trim() : "";
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) return;
      // Only POST from the top frame to avoid duplicate uploads.
      if (!isTopFrame()) return;

      safeSendMessage({ type: "export_logs" }, response => {
        if (chrome.runtime.lastError) {
          console.error("Runtime error while exporting logs:", chrome.runtime.lastError.message);
          return;
        }
        if (response && response.logs) {
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response.logs)
          })
            .then(res => res.text())
            .then(data => console.log("POST successful, response:", data))
            .catch(err => console.error("Error sending POST request:", err));
        } else {
          console.warn("No logs received from background.");
        }
      });
    } catch (err) {
      console.error("Error in periodic export POST:", err);
    }
  }, 10000);

  // Listen for the first configurable key press (no modifiers) and log it, robustly.
  (function installFirstKeyDetector() {
    let fired = false;

    function maybeFire(e) {
      if (fired) return;
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = (e.key || "").toLowerCase();
      if (k !== (CONFIG.syncKey || "s").toLowerCase()) return;

      fired = true;
      const timestamp = new Date().toISOString();
      console.log("First sync key press logged", "key:", CONFIG.syncKey, "Timestamp:", timestamp);

      try {
        safeSendMessage({
          type: "log_keypress",
          data: { message: "First 's' key press logged", timestamp }
        });
      } catch (err) {
        console.error("Failed to send keypress log:", err);
      }

      remove();
    }

    const opts = { capture: true };
    function add() {
      window.addEventListener("keydown", maybeFire, opts);
      window.addEventListener("keyup", maybeFire, opts);
      document.addEventListener("keydown", maybeFire, opts);
      document.addEventListener("keyup", maybeFire, opts);
    }
    function remove() {
      window.removeEventListener("keydown", maybeFire, opts);
      window.removeEventListener("keyup", maybeFire, opts);
      document.removeEventListener("keydown", maybeFire, opts);
      document.removeEventListener("keyup", maybeFire, opts);
    }

    add();
  })();

}

// Status responder for popup: report whether observer is active
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "get_content_status") {
      try {
        sendResponse({ ok: true, observerActive: !!observerActive, hostname: window.location.hostname });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
      return true;
    }
  });
} catch (err) {
  console.error("Failed to attach get_content_status listener:", err);
}
