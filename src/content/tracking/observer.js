// MutationObserver lifecycle + relevancy filter.
(function installObserver() {
  const NS = globalThis.__POSEYEDOM.content;

  let observer = null;
  let observerActive = false;
  let observerRoot = null;

  function isObserverActive() {
    return !!observerActive;
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
      observerActive = false;
      observerRoot = null;
    } else {
      observerActive = false;
    }
  }

  function observerCallback(mutationsList) {
    let relevant = false;
    try {
      const cfg = NS.state.config || {};
      const sel = cfg.selectors || ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview";
      for (const m of mutationsList || []) {
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
          for (const n of Array.from(m.addedNodes || [])) {
            if (scan(n)) {
              relevant = true;
              break;
            }
          }
          if (!relevant) {
            for (const n of Array.from(m.removedNodes || [])) {
              if (scan(n)) {
                relevant = true;
                break;
              }
            }
          }
        } else if (m.type === "attributes") {
          const t = m.target;
          try {
            if (t && t.matches && (t.matches(sel) || t.closest(".suggest-preview-text"))) relevant = true;
            else if (t && t.querySelector && (t.querySelector(sel) || t.querySelector(".suggest-preview-text"))) relevant = true;
          } catch (_) {}
        } else if (m.type === "characterData") {
          try {
            const p = m.target && m.target.parentElement;
            if (p && p.closest && p.closest(".ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview, .suggest-preview-text"))
              relevant = true;
          } catch (_) {}
        }
        if (relevant) break;
      }
    } catch (_) {}

    if (!relevant) return;
    try {
      NS.acceptance && NS.acceptance.detectSuggestionAcceptance && NS.acceptance.detectSuggestionAcceptance();
    } catch (_) {}
    try {
      NS.tracking && NS.tracking.throttledLog && NS.tracking.throttledLog();
    } catch (_) {}
  }

  function startObserver() {
    // If we have an observer but the root was replaced/disconnected, restart it.
    try {
      if (observer && observerRoot && observerRoot.isConnected === false) {
        stopObserver();
      }
    } catch (_) {}

    const root = NS.utils.findEditorRoot();
    if (!root) {
      stopObserver();
      return;
    }

    if (observer && observerRoot === root) {
      observerActive = true;
      return;
    }

    stopObserver();
    observerRoot = root;
    observer = new MutationObserver(observerCallback);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
      characterData: true,
    });
    observerActive = true;
  }

  NS.observer = { startObserver, stopObserver, isObserverActive };
})();


