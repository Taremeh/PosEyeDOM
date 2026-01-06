export function createBackgroundConfig() {
  // Mutable config object, updated via storage.
  const state = { browserWindowOffset: 91, errorMarginH: 44, errorMarginV: 22 };

  function load() {
    try {
      chrome.storage.sync.get({ browserWindowOffset: 91, errorMarginH: 44, errorMarginV: 22 }, (cfg) => {
        try {
          Object.assign(state, cfg || {});
        } catch (_) {}
      });
    } catch (_) {}
  }

  load();

  return {
    get() {
      return state;
    },
    reload() {
      load();
    },
  };
}


