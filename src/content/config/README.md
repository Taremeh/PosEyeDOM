# `src/content/config` — Settings + Hot Reload Hooks

This folder contains the content-script configuration logic:
- reads settings from `chrome.storage.sync`
- listens for `settings_updated` (from popup) and applies changes without requiring manual page refresh

## `index.js`
Exports a small runtime API on the shared namespace:
- `NS.config.loadConfig(cb)`

On settings updates it will:
- refresh throttle (`NS.tracking.refreshThrottle()`)
- reset suggestion state (`NS.tracking.resetSuggestionState()`)
- restart tracking (`NS.tracking.restart()`)


