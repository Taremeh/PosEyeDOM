// Shared namespace for the popup scripts (avoid huge globals).
(function initPopupNamespace() {
  const root = globalThis;
  if (!root.__POSEYEDOM) root.__POSEYEDOM = {};
  if (!root.__POSEYEDOM.popup) root.__POSEYEDOM.popup = {};
  const NS = root.__POSEYEDOM.popup;
  if (!NS.api) NS.api = {};
  if (!NS.state) NS.state = {};
})();


