// Status polling for DB + tracking dots.
(function installStatus() {
  const NS = globalThis.__POSEYEDOM.popup;

  function setDot(id, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("green", "red", "yellow");
    if (color) el.classList.add(color);
  }

  function pollStatus() {
    try {
      chrome.runtime.sendMessage({ type: "get_status" }, (resp) => {
        if (!resp || resp.ok !== true) {
          setDot("dot-db", "red");
          setDot("dot-tracking", "red");
        } else {
          setDot("dot-db", resp.dbConnected ? "green" : "red");
          const age = typeof resp.lastLogAgeMs === "number" ? resp.lastLogAgeMs : null;
          setDot("dot-tracking", age !== null && age < 10000 ? "green" : "red");
        }
      });
    } catch (_) {
      setDot("dot-db", "red");
      setDot("dot-tracking", "red");
    }
  }

  NS.api.pollStatus = pollStatus;
})();


