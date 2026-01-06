// Shared namespace for the content-script bundle (avoid leaking globals).
(function initPoseyedomNamespace() {
  const root = globalThis;
  if (!root.__POSEYEDOM) root.__POSEYEDOM = {};
  if (!root.__POSEYEDOM.content) root.__POSEYEDOM.content = {};

  const NS = root.__POSEYEDOM.content;

  if (!NS.state) {
    NS.state = {
      trackingDisabled: false,
      config: {
        selectors: ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview",
        syncKey: "s",
        remoteUrl: "",
        errorMarginH: 44,
        errorMarginV: 22,
        throttleMs: 200,
        browserWindowOffset: 91,
      },
    };
  }

  if (!NS.api) NS.api = {};
})();


