# `src/background/windows` — Detached Popup Window Management

## `popupCleanup.js`
The dashboard can be “detached” into a standalone popup window. To prevent stale windows lingering across reloads, the extension:
- tracks created popup window IDs in `chrome.storage.local.managedPopupWindows`
- also keeps a `closeOnStartup` list

On extension **startup** and **install**, `popupCleanup.js` reads these IDs and attempts to close them.


