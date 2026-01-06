// Entry point: start watchers/timers on github.dev.
(function runEntry() {
  const NS = globalThis.__POSEYEDOM.content;
  const U = NS.utils;

  function isGithubDev() {
    try {
      return window.location.hostname.endsWith("github.dev");
    } catch (_) {
      return false;
    }
  }

  if (!isGithubDev()) return;

  // Ensure config is loaded and throttle is aligned.
  try {
    if (NS.config && NS.config.loadConfig) {
      NS.config.loadConfig(() => {
        try {
          NS.tracking && NS.tracking.refreshThrottle && NS.tracking.refreshThrottle();
        } catch (_) {}
      });
    } else {
      try {
        NS.tracking && NS.tracking.refreshThrottle && NS.tracking.refreshThrottle();
      } catch (_) {}
    }
  } catch (_) {}

  // Watchdog: ensure observer stays attached (editor DOM can be replaced).
  setInterval(() => {
    try {
      if (NS.state.trackingDisabled) return;
      NS.tracking && NS.tracking.startObserver && NS.tracking.startObserver();
    } catch (err) {
      console.error("Error starting observer:", err);
    }
  }, 10000);

  // Start periodic remote log POST (top frame only).
  try {
    NS.tracking && NS.tracking._internal && NS.tracking._internal.startPeriodicRemotePost();
  } catch (_) {}

  // Install sync key detector.
  try {
    NS.tracking && NS.tracking._internal && NS.tracking._internal.installFirstKeyDetector();
  } catch (_) {}

  // Initial kick once some DOM exists.
  try {
    setTimeout(() => {
      try {
        NS.tracking && NS.tracking.restart && NS.tracking.restart();
      } catch (_) {}
    }, 0);
  } catch (_) {}
})();


