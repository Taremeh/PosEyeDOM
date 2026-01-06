let db = null;

export function getDb() {
  return db;
}

export function initDatabase() {
  const request = indexedDB.open("DivLoggerDB", 2);
  request.onupgradeneeded = (event) => {
    db = event.target.result;
    if (!db.objectStoreNames.contains("logs")) {
      db.createObjectStore("logs", { autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("ias")) {
      db.createObjectStore("ias", { autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("ias_meta")) {
      db.createObjectStore("ias_meta");
    }
  };
  request.onsuccess = (event) => {
    db = event.target.result;
    console.log("Database initialized");
  };
  request.onerror = (event) => {
    console.error("Database error:", event.target.error);
  };
}

export function saveLogToDatabase(data) {
  if (!db) {
    console.error("Database not initialized");
    return;
  }
  const transaction = db.transaction("logs", "readwrite");
  const store = transaction.objectStore("logs");
  store.add(data);
  transaction.oncomplete = () => {
    console.log("Log saved to database");
  };
  transaction.onerror = (event) => {
    console.error("Transaction error:", event.target.error);
  };
}

export function viewLogs(callback) {
  if (!db) {
    console.error("Database not initialized");
    return;
  }
  const transaction = db.transaction("logs", "readonly");
  const store = transaction.objectStore("logs");
  const request = store.getAll();
  request.onsuccess = () => {
    callback(request.result);
  };
  request.onerror = (event) => {
    console.error("Error retrieving logs:", event.target.error);
  };
}

export function clearDatabaseAll(callback) {
  if (!db) {
    console.error("Database not initialized");
    return;
  }
  const transaction = db.transaction(["logs", "ias", "ias_meta"], "readwrite");
  const logsStore = transaction.objectStore("logs");
  const iasStore = transaction.objectStore("ias");
  const metaStore = transaction.objectStore("ias_meta");

  const p1 = new Promise((res) => {
    const r = logsStore.clear();
    r.onsuccess = () => res();
    r.onerror = () => res();
  });
  const p2 = new Promise((res) => {
    const r = iasStore.clear();
    r.onsuccess = () => res();
    r.onerror = () => res();
  });
  const p3 = new Promise((res) => {
    const r = metaStore.clear();
    r.onsuccess = () => res();
    r.onerror = () => res();
  });

  transaction.oncomplete = () => {
    Promise.all([p1, p2, p3]).then(() => {
      // Reinitialize meta baseline
      const tx = db.transaction("ias_meta", "readwrite");
      const s = tx.objectStore("ias_meta");
      s.put(
        {
          baseEpochMs: null,
          lastProcessedIso: null,
          labelState: { _counter: 1 },
          nextId: 1,
          activeRecords: [],
          lastVisibleRoots: [],
          lastVisibleAt: null,
          lastPrimaryRoot: null,
          lastPrimaryAt: null,
        },
        "state",
      );
      tx.oncomplete = () => {
        console.log("Database cleared (logs, ias, ias_meta)");
        if (callback) callback();
      };
      tx.onerror = () => {
        if (callback) callback();
      };
    });
  };
  transaction.onerror = (event) => {
    console.error("Error clearing database:", event.target.error);
    if (callback) callback();
  };
}


