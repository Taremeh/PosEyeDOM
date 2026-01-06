// Facade that composes logging + acceptance + observer and preserves the old `NS.tracking.*` API.
(function installTrackingFacade() {
  const NS = globalThis.__POSEYEDOM.content;
  const U = NS.utils;

  let throttledFn = null;

  function refreshThrottle() {
    const cfg = NS.state.config || {};
    const delay = Math.max(0, Number(cfg.throttleMs != null ? cfg.throttleMs : 200));
    const base = NS.logging && NS.logging.logDivCoordinates ? NS.logging.logDivCoordinates : () => {};
    throttledFn = U.throttle(base, delay);
  }

  function throttledLog() {
    try {
      if (!throttledFn) refreshThrottle();
      throttledFn && throttledFn();
    } catch (_) {}
  }

  function startObserver() {
    try {
      NS.observer && NS.observer.startObserver && NS.observer.startObserver();
    } catch (_) {}
  }

  function stopObserver() {
    try {
      NS.observer && NS.observer.stopObserver && NS.observer.stopObserver();
    } catch (_) {}
  }

  function restart() {
    try {
      stopObserver();
    } catch (_) {}
    try {
      startObserver();
    } catch (_) {}
    try {
      NS.acceptance && NS.acceptance.detectSuggestionAcceptance && NS.acceptance.detectSuggestionAcceptance();
    } catch (_) {}
    try {
      NS.logging && NS.logging.logDivCoordinates && NS.logging.logDivCoordinates();
    } catch (_) {}
  }

  // Status responder for popup
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "get_content_status") {
        try {
          const active = NS.observer && NS.observer.isObserverActive ? NS.observer.isObserverActive() : false;
          sendResponse({ ok: true, observerActive: !!active, hostname: window.location.hostname });
        } catch (e) {
          sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        }
        return true;
      }
    });
  } catch (err) {
    console.error("Failed to attach get_content_status listener:", err);
  }

  // Periodic remote POST (top-frame only)
  function startPeriodicRemotePost() {
    setInterval(() => {
      try {
        const cfg = NS.state.config || {};
        const url = typeof cfg.remoteUrl === "string" ? cfg.remoteUrl.trim() : "";
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) return;
        if (!U.isTopFrame()) return;

        U.safeSendMessage({ type: "export_logs" }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.logs) {
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response.logs),
            })
              .then((res) => res.text())
              .then((data) => console.log("POST successful, response:", data))
              .catch((err) => console.error("Error sending POST request:", err));
          }
        });
      } catch (err) {
        console.error("Error in periodic export POST:", err);
      }
    }, 10000);
  }

  function installFirstKeyDetector() {
    let fired = false;
    function maybeFire(e) {
      if (fired) return;
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const cfg = NS.state.config || {};
      const k = (e.key || "").toLowerCase();
      if (k !== (cfg.syncKey || "s").toLowerCase()) return;
      fired = true;
      const timestamp = new Date().toISOString();
      try {
        U.safeSendMessage({ type: "log_keypress", data: { message: "First 's' key press logged", timestamp } });
      } catch (_) {}
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
  }

  NS.tracking = {
    refreshThrottle,
    throttledLog,
    resetSuggestionState: () =>
      NS.acceptance && NS.acceptance.resetSuggestionState ? NS.acceptance.resetSuggestionState() : undefined,
    stopActivePoll: () => (NS.acceptance && NS.acceptance.stopActivePoll ? NS.acceptance.stopActivePoll() : undefined),
    stopObserver,
    startObserver,
    restart,
    get observerActive() {
      return NS.observer && NS.observer.isObserverActive ? !!NS.observer.isObserverActive() : false;
    },
  };

  NS.tracking._internal = {
    logDivCoordinates: () => (NS.logging && NS.logging.logDivCoordinates ? NS.logging.logDivCoordinates() : undefined),
    detectSuggestionAcceptance: () =>
      NS.acceptance && NS.acceptance.detectSuggestionAcceptance ? NS.acceptance.detectSuggestionAcceptance() : undefined,
    startPeriodicRemotePost,
    installFirstKeyDetector,
  };

  refreshThrottle();
})();


