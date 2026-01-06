// Tab helpers (finding github.dev tab + reattach).
(function installPopupTabs() {
  const NS = globalThis.__POSEYEDOM.popup;

  function pickGithubDevTab(cb) {
    try {
      chrome.tabs.query({ url: ["*://*.github.dev/*"] }, (tabs) => {
        if (chrome.runtime.lastError) {
          cb(null);
          return;
        }
        if (tabs && tabs.length) {
          const activeFocused = tabs.find((t) => t.active && t.highlighted) || null;
          const activeAny = tabs.find((t) => t.active) || null;
          cb(activeFocused || activeAny || tabs[0]);
        } else {
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (t2) => {
            if (t2 && t2.length && t2[0].url && t2[0].url.includes("github.dev")) cb(t2[0]);
            else cb(null);
          });
        }
      });
    } catch (_) {
      cb(null);
    }
  }

  function reattachTracking() {
    pickGithubDevTab((tab) => {
      if (!tab) {
        alert("No github.dev tab found. Open your github.dev tab and try again.");
        return;
      }
      const tabId = tab.id;
      const msg = { type: "force_reattach" };
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) {
          try {
            chrome.tabs.reload(tabId, { bypassCache: true }, () => {
              setTimeout(() => {
                try {
                  NS.api.pollStatus && NS.api.pollStatus();
                } catch (_) {}
              }, 1200);
            });
          } catch (e) {
            console.error("tabs.reload failed:", e);
            alert("Could not reattach. Make sure the github.dev tab is open and loaded.");
          }
          return;
        }
        setTimeout(() => {
          try {
            NS.api.pollStatus && NS.api.pollStatus();
          } catch (_) {}
        }, 300);
      });
    });
  }

  NS.api.pickGithubDevTab = pickGithubDevTab;
  NS.api.reattachTracking = reattachTracking;
})();


