// IA + HTML export flow (asks content script to compute, enriches with background summary).
(function installExportIAHTML() {
  const NS = globalThis.__POSEYEDOM.popup;

  function rootOf(label) {
    const m = String(label || "").match(/^(autolabel_\d+)/);
    return m ? m[1] : String(label || "");
  }

  function buildHtmlExport(mapping, summary) {
    const out = {};
    const acceptedRoots = new Set();
    try {
      if (summary && summary.ok && Array.isArray(summary.records)) {
        summary.records.forEach((r) => {
          try {
            if (r && r.accepted) acceptedRoots.add(rootOf(r.label));
          } catch (_) {}
        });
      }
    } catch (_) {}
    try {
      Object.keys(mapping || {}).forEach((label) => {
        const root = rootOf(label);
        if (!out[root]) out[root] = { content: mapping[label], accepted: acceptedRoots.has(root) };
      });
    } catch (_) {}
    return out;
  }

  async function computeAndExportIAHTML() {
    try {
      const logs = await NS.api.fetchLogs();
      const participantId = (document.getElementById("participant-id").value || "session").trim();
      const offsetMs = Number(document.getElementById("offset-ms").value || 0);
      const defaults = NS.api.DEFAULT_SETTINGS;

      NS.api.pickGithubDevTab((tab) => {
        if (!tab) {
          console.error("No github.dev tab found to send compute request to.");
          alert("No github.dev tab found. Open your github.dev tab and try again.");
          return;
        }
        const tabId = tab.id;
        const errH = Math.max(0, Number(document.getElementById("cfg-err-h").value || defaults.errorMarginH));
        const errV = Math.max(0, Number(document.getElementById("cfg-err-v").value || defaults.errorMarginV));
        const winOff = Math.max(0, Number(document.getElementById("cfg-window-offset").value || defaults.browserWindowOffset));
        const msg = { type: "compute_ia_html_from_logs", logs, offsetMs, errorMarginH: errH, errorMarginV: errV, browserWindowOffset: winOff };

        function handleResponse(response) {
          if (!response || !response.ok) {
            const errMsg = (response && response.error) || "Unknown error computing IA/HTML.";
            console.error("IA/HTML compute error:", errMsg);
            alert(`IA/HTML compute error: ${errMsg}`);
            return;
          }
          const { iasText, htmlMapping } = response;
          NS.api.downloadText(`output_${participantId}.ias`, iasText);

          try {
            chrome.runtime.sendMessage({ type: "get_ia_summary" }, (summary) => {
              if (chrome.runtime.lastError || !summary || summary.ok !== true) {
                const fallback = buildHtmlExport(htmlMapping, null);
                NS.api.downloadJSON(`html_${participantId}.json`, fallback);
                console.warn(
                  "Falling back to export without acceptance enrichment",
                  chrome.runtime.lastError ? chrome.runtime.lastError.message : "no summary",
                );
                return;
              }
              const enriched = buildHtmlExport(htmlMapping, summary);
              NS.api.downloadJSON(`html_${participantId}.json`, enriched);
            });
          } catch (_) {
            const fallback = buildHtmlExport(htmlMapping, null);
            NS.api.downloadJSON(`html_${participantId}.json`, fallback);
          }
        }

        chrome.tabs.sendMessage(tabId, msg, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Initial message failed, attempting to inject content script and retry:", chrome.runtime.lastError.message);
            try {
              chrome.scripting.executeScript(
                {
                  target: { tabId, allFrames: true },
                  files: [
                    "src/content/00_namespace.js",
                    "src/content/10_utils.js",
                    "src/content/20_ia_computer.js",
                    "src/content/config/index.js",
                    "src/content/tracking/logging.js",
                    "src/content/tracking/acceptance.js",
                    "src/content/tracking/observer.js",
                    "src/content/tracking/index.js",
                    "src/content/99_entry.js",
                  ],
                },
                () => {
                  setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, msg, (resp2) => {
                      if (chrome.runtime.lastError) {
                        console.error("Retry after inject failed:", chrome.runtime.lastError.message);
                        alert("Could not reach content script. Make sure the github.dev tab is open.");
                        return;
                      }
                      handleResponse(resp2);
                    });
                  }, 50);
                },
              );
            } catch (e) {
              console.error("executeScript failed:", e);
              alert("Could not reach content script. Make sure the github.dev tab is open.");
            }
            return;
          }
          handleResponse(response);
        });
      });
    } catch (err) {
      console.error("Failed to compute/export IA+HTML:", err);
      alert(`Failed to export IA/HTML: ${err && err.message ? err.message : String(err)}`);
    }
  }

  NS.api.computeAndExportIAHTML = computeAndExportIAHTML;
})();


