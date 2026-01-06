// Suggestion acceptance detection + focus/esc hooks + active poll.
(function installAcceptance() {
  const NS = globalThis.__POSEYEDOM.content;
  const U = NS.utils;

  const GHOST_CLASSES = ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview";
  const SUGG_STATE = { active: false, lines: new Map(), lastSeenAt: 0, compareTimer: null, lastEmptyAt: 0 };
  let ACTIVE_POLL_TIMER = null;

  function resetSuggestionState() {
    try {
      if (SUGG_STATE.compareTimer) {
        clearTimeout(SUGG_STATE.compareTimer);
        SUGG_STATE.compareTimer = null;
      }
    } catch (_) {}
    SUGG_STATE.active = false;
    SUGG_STATE.lines = new Map();
    SUGG_STATE.lastSeenAt = 0;
    SUGG_STATE.lastEmptyAt = 0;
  }

  function ensureActivePoll() {
    if (ACTIVE_POLL_TIMER) return;
    ACTIVE_POLL_TIMER = setInterval(() => {
      try {
        if (!SUGG_STATE.active) return;
        detectSuggestionAcceptance();
        NS.tracking && NS.tracking.throttledLog && NS.tracking.throttledLog();
      } catch (_) {}
    }, 250);
  }

  function stopActivePoll() {
    if (!ACTIVE_POLL_TIMER) return;
    try {
      clearInterval(ACTIVE_POLL_TIMER);
    } catch (_) {}
    ACTIVE_POLL_TIMER = null;
  }

  function forceRejectOnFocusLoss(reason) {
    try {
      NS.logging && NS.logging.sendEmptySnapshot && NS.logging.sendEmptySnapshot(reason || "focus_loss");
    } catch (_) {}
    try {
      resetSuggestionState();
    } catch (_) {}
    try {
      stopActivePoll();
    } catch (_) {}
  }

  function collectGhostLines() {
    try {
      const cfg = NS.state.config || {};
      const root = document.querySelector(".editor-instance") || document;
      const lines = Array.from(root.querySelectorAll(".view-line"));
      const blocks = [];
      for (let i = 0; i < lines.length; i++) {
        const lineEl = lines[i];
        let hasGhost = false;
        try {
          const ghosts = lineEl.querySelectorAll(cfg.selectors || GHOST_CLASSES);
          hasGhost = Array.from(ghosts).some(U.isElementVisible);
        } catch (_) {
          hasGhost = false;
        }
        if (!hasGhost) continue;
        const isPreview = !!lineEl.closest(".suggest-preview-text");
        if (isPreview) continue;
        const det = U.extractLineStyleDetails(lineEl);
        if (det.top == null) continue;
        let combined = "";
        try {
          const ghostsInLine = lineEl.querySelectorAll(cfg.selectors || GHOST_CLASSES);
          combined = Array.from(ghostsInLine).filter(U.isElementVisible).map((el) => el.textContent || "").join("");
        } catch (_) {
          combined = lineEl.textContent || "";
        }
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          const inPreview = !!nextLine.closest(".suggest-preview-text");
          if (!inPreview) break;
          let nextHasGhost = false;
          try {
            const ghosts = nextLine.querySelectorAll(cfg.selectors || GHOST_CLASSES);
            nextHasGhost = Array.from(ghosts).some(U.isElementVisible);
          } catch (_) {
            nextHasGhost = false;
          }
          if (!nextHasGhost) break;
          try {
            const ghostsInNext = nextLine.querySelectorAll(cfg.selectors || GHOST_CLASSES);
            const t = Array.from(ghostsInNext).filter(U.isElementVisible).map((el) => el.textContent || "").join("");
            combined += "\n" + t;
          } catch (_) {
            combined += "\n" + (nextLine.textContent || "");
          }
          j += 1;
        }
        blocks.push({
          top: det.top,
          height: det.height,
          lineHeight: det.lineHeight,
          snapshotText: combined,
          snapshotNorm: U.normalizeText(combined),
        });
      }

      // Fallback: preview-only suggestions (no non-preview anchor yet)
      if (blocks.length === 0) {
        const previews = Array.from(root.querySelectorAll(".suggest-preview-text"));
        previews.forEach((pv) => {
          try {
            const childLines = Array.from(pv.querySelectorAll(".view-line")).filter((el) => {
              try {
                const ghosts = el.querySelectorAll(cfg.selectors || GHOST_CLASSES);
                return Array.from(ghosts).some(U.isElementVisible);
              } catch (_) {
                return false;
              }
            });
            if (childLines.length === 0) return;
            const combined = childLines
              .map((pl) => {
                try {
                  const ghosts = pl.querySelectorAll(cfg.selectors || GHOST_CLASSES);
                  return Array.from(ghosts).filter(U.isElementVisible).map((el) => el.textContent || "").join("");
                } catch (_) {
                  return pl.textContent || "";
                }
              })
              .join("\n");

            const y = pv.getBoundingClientRect ? pv.getBoundingClientRect().top : 0;
            const realLines = lines.filter((el) => !el.closest(".suggest-preview-text"));
            let best = null;
            let bestDy = Infinity;
            realLines.forEach((el) => {
              try {
                const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                const dy = r ? y - r.top : Infinity;
                if (dy >= -4 && dy < bestDy) {
                  bestDy = dy;
                  best = el;
                }
              } catch (_) {}
            });
            if (!best && realLines.length > 0) best = realLines[0];
            const detA = best ? U.extractLineStyleDetails(best) : { top: 0, height: null, lineHeight: null };
            const topA = detA.top != null ? detA.top : 0;
            blocks.push({
              top: topA,
              height: detA.height,
              lineHeight: detA.lineHeight,
              snapshotText: combined,
              snapshotNorm: U.normalizeText(combined),
            });
            try {
              console.log("[Acceptance] preview-only snapshot anchored", { anchorTop: topA, previewLines: childLines.length, len: combined.length });
            } catch (_) {}
          } catch (_) {}
        });
      }

      return blocks;
    } catch (_) {
      return [];
    }
  }

  function collectDownwardTextFromTop(topStart, lineHeightHint) {
    try {
      const lines = Array.from(document.querySelectorAll(".view-line"));
      const entries = lines
        .map((el) => ({ el, top: U.extractTopPxFromStyle(el), det: U.extractLineStyleDetails(el) }))
        .filter((e) => e.top != null)
        .sort((a, b) => a.top - b.top);
      if (entries.length === 0) return "";
      const EPS = 1.0;
      let startIdx = entries.findIndex((e) => Math.abs(e.top - topStart) <= EPS);
      if (startIdx === -1) {
        startIdx = entries.findIndex((e) => e.top >= topStart - EPS);
        if (startIdx === -1) startIdx = 0;
      }
      const startLH =
        typeof lineHeightHint === "number" && lineHeightHint > 0
          ? lineHeightHint
          : entries[startIdx].det.lineHeight || entries[startIdx].det.height || 27;
      let out = "";
      let lastTop = null;
      for (let i = startIdx; i < entries.length && i < startIdx + 20; i++) {
        const cur = entries[i];
        if (lastTop != null) {
          const gap = cur.top - lastTop;
          if (gap > startLH * 2.2) break;
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
    try {
      const still = collectGhostLines();
      if (still && still.length > 0) {
        console.log("[Acceptance] compare aborted; ghosts visible again", still.length);
        SUGG_STATE.compareTimer = null;
        return;
      }
    } catch (_) {}
    if (!(SUGG_STATE.active && SUGG_STATE.lines && SUGG_STATE.lines.size > 0)) return;

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

      const nowNorm = U.normalizeText(combinedCurrent);
      const idx = expectedNorm ? nowNorm.indexOf(expectedNorm) : -1;
      const ok = idx >= 0 && idx < Math.min(nowNorm.length, MAX_MATCH_PREFIX_CHARS);
      if (ok) {
        anyOk = true;
        if (bestIdx === null || idx < bestIdx) {
          bestIdx = idx;
          bestTop = v.top;
        }
      }

      try {
        U.safeSendMessage({
          type: "log_acceptance_check",
          data: { top: v.top, ok, idx, detectedAt: new Date().toISOString(), expectedText: v.snapshotText, nowText: combinedCurrent },
        });
      } catch (_) {}
    });

    if (anyOk) {
      try {
        U.safeSendMessage({
          type: "log_acceptance",
          data: {
            message: "Suggestion accepted",
            lines: linesForLog,
            seenAt: SUGG_STATE.lastSeenAt,
            detectedAt: new Date().toISOString(),
            decision: { bestTop, bestIdx, totalAnchors, rule: { maxMatchPrefixChars: MAX_MATCH_PREFIX_CHARS } },
          },
        });
      } catch (_) {}
    }

    resetSuggestionState();
    stopActivePoll();
  }

  function detectSuggestionAcceptance() {
    try {
      const ghosts = collectGhostLines();
      if (ghosts.length > 0) {
        const firstActivate = !SUGG_STATE.active;
        const newMap = new Map();
        ghosts.forEach((g) => {
          newMap.set(`top:${g.top}`, { top: g.top, height: g.height, lineHeight: g.lineHeight, snapshotText: g.snapshotText, snapshotNorm: g.snapshotNorm });
        });
        SUGG_STATE.active = true;
        ensureActivePoll();
        SUGG_STATE.lines = newMap;
        SUGG_STATE.lastSeenAt = Date.now();
        SUGG_STATE.lastEmptyAt = 0;
        if (SUGG_STATE.compareTimer) {
          try {
            clearTimeout(SUGG_STATE.compareTimer);
          } catch (_) {}
          SUGG_STATE.compareTimer = null;
        }
        if (firstActivate) {
          try {
            console.log("[Acceptance] snapshot captured", Array.from(newMap.values()).map((v) => ({ top: v.top, len: (v.snapshotText || "").length })));
          } catch (_) {}
        }
        return;
      }

      if (SUGG_STATE.active && SUGG_STATE.lines && SUGG_STATE.lines.size > 0) {
        const now = Date.now();
        if (!SUGG_STATE.lastEmptyAt) SUGG_STATE.lastEmptyAt = now;
        const stableMs = now - SUGG_STATE.lastEmptyAt;
        if (!SUGG_STATE.compareTimer && stableMs >= 150) {
          SUGG_STATE.compareTimer = setTimeout(() => {
            try {
              requestAnimationFrame(() => runAcceptanceCompare());
            } catch (_) {
              runAcceptanceCompare();
            }
          }, 0);
        } else if (!SUGG_STATE.compareTimer) {
          SUGG_STATE.compareTimer = setTimeout(() => {
            SUGG_STATE.compareTimer = null;
            detectSuggestionAcceptance();
          }, 160 - stableMs);
        }
      } else {
        stopActivePoll();
        SUGG_STATE.lastEmptyAt = 0;
      }
    } catch (err) {
      console.error("detectSuggestionAcceptance error", err);
    }
  }

  // ESC dismiss hook
  try {
    window.addEventListener(
      "keydown",
      (e) => {
        try {
          if (!e || e.key !== "Escape") return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          setTimeout(() => {
            try {
              detectSuggestionAcceptance();
            } catch (_) {}
            try {
              NS.logging && NS.logging.logDivCoordinates && NS.logging.logDivCoordinates();
            } catch (_) {}
          }, 0);
        } catch (_) {}
      },
      { capture: true },
    );
  } catch (_) {}

  // Focus loss hooks
  try {
    window.addEventListener(
      "blur",
      () => {
        try {
          forceRejectOnFocusLoss("window_blur");
        } catch (_) {}
      },
      { capture: true },
    );
  } catch (_) {}

  try {
    document.addEventListener(
      "visibilitychange",
      () => {
        try {
          if (document.hidden) forceRejectOnFocusLoss("document_hidden");
        } catch (_) {}
      },
      { capture: true },
    );
  } catch (_) {}

  NS.acceptance = {
    detectSuggestionAcceptance,
    resetSuggestionState,
    ensureActivePoll,
    stopActivePoll,
    forceRejectOnFocusLoss,
  };
})();


