// Routes runtime messages to background features (DB, IA cache, status).

const LAST_COORD_SIG_BY_SENDER = new Map(); // key -> { sig, at }

function senderKey(sender) {
  try {
    const tabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : "no_tab";
    const frameId = sender && typeof sender.frameId === "number" ? sender.frameId : 0;
    return `${tabId}:${frameId}`;
  } catch (_) {
    return "unknown";
  }
}

export function installMessageRouter({
  bgConfig,
  getDb,
  saveLogToDatabase,
  viewLogs,
  clearDatabaseAll,
  iasCache,
}) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.type) return;

      if (message.type === "settings_updated") {
        bgConfig.reload();
        return;
      }

      if (message.type === "log_coordinates") {
        // Dedupe identical signatures from the same tab+frame within a short window
        try {
          const sig = message && message.data && typeof message.data.signature === "string" ? message.data.signature : null;
          if (sig) {
            const key = senderKey(sender);
            const prev = LAST_COORD_SIG_BY_SENDER.get(key);
            const now = Date.now();
            if (prev && prev.sig === sig && now - prev.at < 500) {
              return;
            }
            LAST_COORD_SIG_BY_SENDER.set(key, { sig, at: now });
          }
        } catch (_) {}

        const logEntry = {
          timestamp: new Date().toISOString(),
          coordinates: message.data,
        };
        saveLogToDatabase(logEntry);
        return;
      }

      if (message.type === "log_keypress") {
        const kp = message.data || {};
        const entry = {
          timestamp: kp.timestamp || new Date().toISOString(),
          coordinates: {
            message: kp.message || "First 's' key press logged",
            timestamp: kp.timestamp || new Date().toISOString(),
          },
        };
        saveLogToDatabase(entry);
        return;
      }

      if (message.type === "log_acceptance") {
        const data = message.data || {};
        const entry = {
          timestamp: new Date().toISOString(),
          event: { type: "suggestion_accepted", ...data },
        };
        saveLogToDatabase(entry);
        iasCache.markAcceptanceAgainstPrimaryRoot();
        return;
      }

      if (message.type === "log_acceptance_check") {
        iasCache.appendAcceptanceCheck(message.data || {});
        return;
      }

      if (message.type === "view_logs") {
        viewLogs((logs) => {
          sendResponse({ logs });
        });
        return true;
      }

      if (message.type === "export_logs") {
        viewLogs((logs) => {
          sendResponse({ logs });
        });
        return true;
      }

      if (message.type === "clear_database") {
        clearDatabaseAll(() => {
          sendResponse({ status: "cleared" });
        });
        return true;
      }

      if (message.type === "force_update_ias" || message.type === "get_ia_summary") {
        iasCache.updateIasCache(() => {
          if (message.type === "force_update_ias") {
            sendResponse({ ok: true });
          } else {
            iasCache.getIasSummary((summary) => sendResponse(summary));
          }
        });
        return true;
      }

      if (message.type === "get_status") {
        iasCache.getStatus((status) => sendResponse({ ok: true, ...status }));
        return true;
      }

      // Other message types intentionally ignored.
    } catch (err) {
      console.error("background message handler error:", err);
    }
  });
}


