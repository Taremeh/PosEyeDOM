// Sync config from chrome.storage and react to settings updates.
(function installConfig() {
  const NS = globalThis.__POSEYEDOM.content;

  function loadConfig(callback) {
    try {
      const defaults = {
        ...NS.state.config,
        throttleMs: 200,
        browserWindowOffset: 91,
        errorMarginH: 44,
        errorMarginV: 22,
      };
      chrome.storage.sync.get(defaults, (cfg) => {
        try {
          NS.state.config = { ...NS.state.config, ...(cfg || {}) };
        } catch (_) {}
        try {
          if (typeof callback === "function") callback(NS.state.config);
        } catch (_) {}
      });
    } catch (_) {}
  }

  // initial load
  loadConfig();

  // Handle settings updates coming from the popup.
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "settings_updated") {
        const incoming = message && message.data ? message.data : null;
        if (incoming && typeof incoming === "object") {
          try {
            NS.state.config = { ...NS.state.config, ...incoming };
          } catch (_) {}
        }

        loadConfig(() => {
          try {
            if (NS.tracking && NS.tracking.refreshThrottle) NS.tracking.refreshThrottle();
          } catch (_) {}
          try {
            if (NS.tracking && NS.tracking.resetSuggestionState) NS.tracking.resetSuggestionState();
          } catch (_) {}
          try {
            if (NS.tracking && NS.tracking.restart) NS.tracking.restart();
          } catch (_) {}
          try {
            sendResponse && sendResponse({ ok: true });
          } catch (_) {}
        });

        return true;
      }

      if (message && message.type === "force_reattach") {
        loadConfig(() => {
          try {
            if (NS.tracking && NS.tracking.refreshThrottle) NS.tracking.refreshThrottle();
          } catch (_) {}
          try {
            if (NS.tracking && NS.tracking.restart) NS.tracking.restart();
          } catch (_) {}
          try {
            sendResponse && sendResponse({ ok: true });
          } catch (_) {}
        });
        return true;
      }
    });
  } catch (_) {}

  NS.config = { loadConfig };
})();


