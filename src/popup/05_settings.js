// Settings + extension/tab reload orchestration.
(function installPopupSettings() {
  const NS = globalThis.__POSEYEDOM.popup;

  const DEFAULT_SETTINGS = {
    theme: "light",
    syncKey: "s",
    selectors: ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview",
    remoteUrl: "",
    throttleMs: 200,
    browserWindowOffset: 91,
    errorMarginH: 44,
    errorMarginV: 22,
  };

  function applyTheme(theme) {
    const cls = theme === "light" ? "theme-light" : "";
    document.documentElement.className = cls;
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (cfg) => {
        const isLight = (cfg.theme || DEFAULT_SETTINGS.theme) === "light";
        const themeCheckbox = document.getElementById("cfg-theme");
        if (themeCheckbox) themeCheckbox.checked = isLight;
        applyTheme(isLight ? "light" : "dark");
        document.getElementById("cfg-sync-key").value = cfg.syncKey || DEFAULT_SETTINGS.syncKey;
        document.getElementById("cfg-selectors").value = cfg.selectors || DEFAULT_SETTINGS.selectors;
        document.getElementById("cfg-remote-url").value = cfg.remoteUrl || DEFAULT_SETTINGS.remoteUrl;
        document.getElementById("cfg-throttle").value = String(cfg.throttleMs != null ? cfg.throttleMs : DEFAULT_SETTINGS.throttleMs);
        document.getElementById("cfg-window-offset").value = String(cfg.browserWindowOffset != null ? cfg.browserWindowOffset : DEFAULT_SETTINGS.browserWindowOffset);
        document.getElementById("cfg-err-h").value = String(cfg.errorMarginH != null ? cfg.errorMarginH : DEFAULT_SETTINGS.errorMarginH);
        document.getElementById("cfg-err-v").value = String(cfg.errorMarginV != null ? cfg.errorMarginV : DEFAULT_SETTINGS.errorMarginV);
      });
    } catch (e) {
      console.error("loadSettings error", e);
    }
  }

  function fullReloadExtensionAndTabs() {
    try {
      chrome.tabs.query({ url: ["*://*.github.dev/*"] }, (tabs) => {
        try {
          (tabs || []).forEach((t) => {
            try {
              chrome.tabs.reload(t.id, { bypassCache: true });
            } catch (_) {}
          });
        } catch (_) {}
        try {
          setTimeout(() => {
            try {
              chrome.runtime.reload();
            } catch (_) {}
          }, 150);
        } catch (_) {
          try {
            chrome.runtime.reload();
          } catch (_) {}
        }
      });
    } catch (_) {
      try {
        chrome.runtime.reload();
      } catch (_) {}
    }
  }

  function closeOtherPopupWindowsThen(fn) {
    try {
      chrome.windows.getCurrent({}, (current) => {
        chrome.storage.local.get({ managedPopupWindows: [], closeOnStartup: [] }, (res) => {
          const managed = new Set(Array.isArray(res.managedPopupWindows) ? res.managedPopupWindows : []);
          const closeOnStartup = new Set(Array.isArray(res.closeOnStartup) ? res.closeOnStartup : []);
          if (current && typeof current.id === "number") closeOnStartup.add(current.id);
          chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, (wins) => {
            const stillManaged = [];
            (wins || []).forEach((w) => {
              try {
                if (current && w.id === current.id) return;
                let shouldClose = false;
                if (managed.has(w.id)) shouldClose = true;
                const tabs = Array.isArray(w.tabs) ? w.tabs : [];
                const extUrl = chrome.runtime.getURL("popup.html");
                const hasOurPopup = tabs.some((tb) => (tb.url || "").indexOf(extUrl) === 0);
                const emptyOrNewTab =
                  tabs.length === 0 ||
                  tabs.some((tb) => (tb.url || "").startsWith("chrome://") || (tb.url || "").startsWith("about:"));
                if (hasOurPopup || emptyOrNewTab) shouldClose = true;
                if (shouldClose) {
                  try {
                    chrome.windows.remove(w.id);
                  } catch (_) {}
                } else {
                  if (managed.has(w.id)) stillManaged.push(w.id);
                }
              } catch (_) {}
            });
            try {
              chrome.storage.local.set({ managedPopupWindows: stillManaged, closeOnStartup: Array.from(closeOnStartup) });
            } catch (_) {}
            try {
              setTimeout(() => {
                try {
                  fn && fn();
                } catch (_) {}
              }, 120);
            } catch (_) {
              try {
                fn && fn();
              } catch (_) {}
            }
          });
        });
      });
    } catch (_) {
      try {
        fn && fn();
      } catch (_) {}
    }
  }

  function saveSettings() {
    const isLight = !!document.getElementById("cfg-theme").checked;
    const theme = isLight ? "light" : "dark";
    const syncKey = (document.getElementById("cfg-sync-key").value || "").trim() || DEFAULT_SETTINGS.syncKey;
    const selectors = (document.getElementById("cfg-selectors").value || DEFAULT_SETTINGS.selectors).trim();
    const remoteUrl = (document.getElementById("cfg-remote-url").value || DEFAULT_SETTINGS.remoteUrl).trim();
    const throttleMs = Math.max(0, Number(document.getElementById("cfg-throttle").value || DEFAULT_SETTINGS.throttleMs));
    const browserWindowOffset = Math.max(
      0,
      Number(document.getElementById("cfg-window-offset").value || DEFAULT_SETTINGS.browserWindowOffset),
    );
    const errorMarginH = Math.max(0, Number(document.getElementById("cfg-err-h").value || DEFAULT_SETTINGS.errorMarginH));
    const errorMarginV = Math.max(0, Number(document.getElementById("cfg-err-v").value || DEFAULT_SETTINGS.errorMarginV));

    try {
      chrome.storage.sync.set(
        { theme, syncKey, selectors, remoteUrl, throttleMs, browserWindowOffset, errorMarginH, errorMarginV },
        () => {
          applyTheme(theme);
          try {
            chrome.runtime.sendMessage({
              type: "settings_updated",
              data: { theme, syncKey, selectors, remoteUrl, throttleMs, browserWindowOffset, errorMarginH, errorMarginV },
            });
          } catch (_) {}
          try {
            chrome.storage.local.set({ reloadNotice: { show: true, at: Date.now() } });
          } catch (_) {}
          closeOtherPopupWindowsThen(() => fullReloadExtensionAndTabs());
        },
      );
    } catch (e) {
      console.error("saveSettings error", e);
    }
  }

  function resetSettings() {
    try {
      chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
        loadSettings();
        const el = document.getElementById("settings-status");
        if (el) el.textContent = "Defaults restored.";
        try {
          chrome.runtime.sendMessage({ type: "settings_updated", data: { ...DEFAULT_SETTINGS } });
        } catch (_) {}
        try {
          chrome.storage.local.set({ reloadNotice: { show: true, at: Date.now() } });
        } catch (_) {}
        closeOtherPopupWindowsThen(() => fullReloadExtensionAndTabs());
      });
    } catch (e) {
      console.error("resetSettings error", e);
    }
  }

  NS.api.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  NS.api.applyTheme = applyTheme;
  NS.api.loadSettings = loadSettings;
  NS.api.saveSettings = saveSettings;
  NS.api.resetSettings = resetSettings;
})();


