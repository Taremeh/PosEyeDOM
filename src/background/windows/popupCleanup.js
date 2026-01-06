function closeMarkedPopups() {
  try {
    chrome.storage.local.get({ managedPopupWindows: [], closeOnStartup: [] }, (res) => {
      const ids = new Set([
        ...(Array.isArray(res.managedPopupWindows) ? res.managedPopupWindows : []),
        ...(Array.isArray(res.closeOnStartup) ? res.closeOnStartup : []),
      ]);
      if (ids.size === 0) return;
      ids.forEach((id) => {
        try {
          chrome.windows.remove(Number(id));
        } catch (_) {}
      });
      try {
        chrome.storage.local.set({ closeOnStartup: [] });
      } catch (_) {}
    });
  } catch (_) {}
}

export function installPopupWindowCleanup() {
  try {
    if (chrome && chrome.runtime && chrome.runtime.onInstalled) {
      chrome.runtime.onInstalled.addListener(() => {
        try {
          closeMarkedPopups();
        } catch (_) {}
      });
    }
    if (chrome && chrome.runtime && chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        try {
          closeMarkedPopups();
        } catch (_) {}
      });
    }
  } catch (_) {}
}


