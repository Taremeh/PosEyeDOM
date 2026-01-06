// IndexedDB helpers + raw log rendering.
(function installPopupDb() {
  const NS = globalThis.__POSEYEDOM.popup;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open("DivLoggerDB");
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  function fetchLogs() {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await openDatabase();
        const transaction = db.transaction("logs", "readonly");
        const store = transaction.objectStore("logs");
        const logs = [];
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            logs.push(cursor.value);
            cursor.continue();
          } else {
            resolve(logs);
          }
        };
        cursorRequest.onerror = (event) => reject(event.target.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  function displayLogs(logs) {
    const pre = document.getElementById("logs");
    if (!logs || logs.length === 0) {
      pre.textContent = "No logs available. Open a GitHub Codespace to start tracking suggestions.";
    } else {
      pre.textContent = JSON.stringify(logs, null, 2);
    }
  }

  NS.api.openDatabase = openDatabase;
  NS.api.fetchLogs = fetchLogs;
  NS.api.displayLogs = displayLogs;
})();


