import { initDatabase, getDb, saveLogToDatabase, viewLogs, clearDatabaseAll } from "./storage/db.js";
import { createBackgroundConfig } from "./storage/config.js";
import { createIasCache } from "./storage/iasCache.js";
import { installPopupWindowCleanup } from "./windows/popupCleanup.js";
import { installMessageRouter } from "./workers/messageRouter.js";

export function initBackground() {
  const bgConfig = createBackgroundConfig();

  // DB is shared across modules, but encapsulated behind getters.
  initDatabase();

  const iasCache = createIasCache({ getDb, bgConfig });

  installMessageRouter({
    bgConfig,
    getDb,
    saveLogToDatabase,
    viewLogs,
    clearDatabaseAll,
    iasCache,
  });

  installPopupWindowCleanup();
}


