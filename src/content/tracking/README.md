# `src/content/tracking` — Ghost Tracking + Acceptance

These files belong together and implement the “runtime tracking” of suggestions on `github.dev`.

## Modules
- `logging.js`
  - Captures visible ghost DOM elements and emits `log_coordinates` snapshots.
  - Emits “empty snapshots” when we need to force-close a suggestion (e.g. focus loss).
- `acceptance.js`
  - Captures ghost text while visible.
  - When ghosts disappear, compares captured ghost text against current editor text (near the top) and emits:
    - `log_acceptance_check` (per-anchor diagnostics)
    - `log_acceptance` (if any anchor matches)
- `observer.js`
  - Attaches a `MutationObserver` to the editor root.
  - Filters to only react to mutations likely related to ghost suggestions (reduces overhead).
- `index.js`
  - “Facade” that wires the above together and exposes the stable `NS.tracking.*` API used by:
    - `src/content/30_config.js` (settings updates)
    - `src/content/99_entry.js` (startup timers + initial kick)


