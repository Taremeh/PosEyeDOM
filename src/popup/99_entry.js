// Wire up DOM event handlers and kick off periodic updates.
(function runPopupEntry() {
  const NS = globalThis.__POSEYEDOM.popup;

  function showView(which) {
    const viewHome = document.getElementById("view-home");
    const viewSettings = document.getElementById("view-settings");
    const navHome = document.getElementById("nav-home");
    const navSettings = document.getElementById("nav-settings");

    if (which === "home") {
      viewHome.classList.remove("hidden");
      viewSettings.classList.add("hidden");
      navHome.classList.add("active");
      navSettings.classList.remove("active");
    } else {
      viewSettings.classList.remove("hidden");
      viewHome.classList.add("hidden");
      navSettings.classList.add("active");
      navHome.classList.remove("active");
    }
  }

  // Nav
  try {
    document.getElementById("nav-home").addEventListener("click", () => showView("home"));
    document.getElementById("nav-settings").addEventListener("click", () => showView("settings"));
  } catch (_) {}

  // Raw logs toggle
  const logsContainer = document.getElementById("logs-container");
  const showLogsBtn = document.getElementById("view-logs");
  try {
    showLogsBtn.addEventListener("click", async () => {
      try {
        const isHidden = logsContainer.classList.contains("hidden");
        if (isHidden) {
          const logs = await NS.api.fetchLogs();
          NS.api.displayLogs(logs);
          logsContainer.classList.remove("hidden");
          showLogsBtn.textContent = "Hide Logs";
        } else {
          logsContainer.classList.add("hidden");
          showLogsBtn.textContent = "Show Logs";
        }
      } catch (e) {
        console.error("toggle logs error", e);
      }
    });
  } catch (_) {}

  // Buttons
  try {
    document.getElementById("export-logs").addEventListener("click", async () => {
      try {
        const logs = await NS.api.fetchLogs();
        NS.api.exportLogs(logs);
      } catch (err) {
        console.error(err);
      }
    });
  } catch (_) {}

  try {
    document.getElementById("export-ia-html").addEventListener("click", NS.api.computeAndExportIAHTML);
  } catch (_) {}

  try {
    document.getElementById("clear-db").addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: "clear_database" }, () => {
          if (chrome.runtime.lastError) {
            console.error("clear_database error:", chrome.runtime.lastError.message);
            return;
          }
          if (!logsContainer.classList.contains("hidden")) {
            document.getElementById("logs").textContent = "Database cleared!";
          }
          NS.api.requestIASummaryAndRender();
          NS.api.pollStatus();
        });
      } catch (e) {
        console.error("clear_database send error", e);
      }
    });
  } catch (_) {}

  // Detach window
  try {
    const detachBtn = document.getElementById("detach-window");
    try {
      const params = new URLSearchParams(location.search || "");
      if (params.get("detached") === "1") detachBtn.style.display = "none";
    } catch (_) {}
    detachBtn.addEventListener("click", () => {
      try {
        const url = chrome.runtime.getURL("popup.html") + "?detached=1";
        chrome.windows.create({ url, type: "popup", width: 520, height: 720, focused: true }, (w) => {
          try {
            if (w && typeof w.id === "number") {
              chrome.storage.local.get({ managedPopupWindows: [] }, (res) => {
                try {
                  const arr = Array.isArray(res.managedPopupWindows) ? res.managedPopupWindows : [];
                  if (!arr.includes(w.id)) arr.push(w.id);
                  chrome.storage.local.set({ managedPopupWindows: arr });
                } catch (_) {}
              });
            }
          } catch (_) {}
          try {
            window.close();
          } catch (_) {}
        });
      } catch (e) {
        console.error("Failed to detach window", e);
      }
    });
  } catch (_) {}

  // Settings buttons
  try {
    document.getElementById("save-settings").addEventListener("click", NS.api.saveSettings);
    document.getElementById("reset-settings").addEventListener("click", NS.api.resetSettings);
  } catch (_) {}

  // Tracking chip reattach
  try {
    const trackingChip = document.getElementById("status-tracking-chip");
    const trackingLabel = document.getElementById("status-tracking-label");
    if (trackingChip) trackingChip.addEventListener("click", () => NS.api.reattachTracking());
    if (trackingChip && trackingLabel) {
      const baseText = trackingLabel.textContent || "Tracking";
      trackingChip.addEventListener("mouseenter", () => {
        try {
          trackingLabel.textContent = "Click to reattach";
        } catch (_) {}
      });
      trackingChip.addEventListener("mouseleave", () => {
        try {
          trackingLabel.textContent = baseText;
        } catch (_) {}
      });
      trackingChip.addEventListener(
        "blur",
        () => {
          try {
            trackingLabel.textContent = baseText;
          } catch (_) {}
        },
        true,
      );
    }
  } catch (_) {}

  // Periodic updates
  setInterval(NS.api.tickUpdateIAS, 2000);
  setInterval(NS.api.pollStatus, 2000);

  // Initial paint
  NS.api.requestIASummaryAndRender();
  NS.api.pollStatus();
  NS.api.loadSettings();
  try {
    showView("home");
  } catch (_) {}
})();


