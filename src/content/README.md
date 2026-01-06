# `src/content` — Content Script (Tracking + Acceptance)

This directory contains the **content script bundle** that runs on `*://*.github.dev/*` (all frames, `document_start`), loaded in a fixed order by `manifest.json`.

## Responsibilities
- **Track ghost overlays** (the Monaco “ghost text” DOM elements)
- **Log geometry snapshots** to the background (`log_coordinates`)
- **Detect acceptance** by comparing a captured ghost snapshot to subsequent editor text (`log_acceptance`, `log_acceptance_check`)
- **Provide IA/HTML computation** on-demand for export (`compute_ia_html_from_logs`)

## Load Order (important)
The scripts are loaded in this order (see `manifest.json`):
1. `00_namespace.js` — shared namespace + config state (`globalThis.__POSEYEDOM.content`)
2. `10_utils.js` — helpers: throttle, DOM helpers, safe `sendMessage`, visibility checks
3. `20_ia_computer.js` — computes IA/HTML for export; registers `compute_ia_html_from_logs`
4. `config/index.js` — reads settings from `chrome.storage.sync`; listens to `settings_updated` + `force_reattach`
5. `tracking/logging.js` — builds and emits geometry snapshots; empty snapshot helper
6. `tracking/acceptance.js` — ghost capture → stable absence → compare → emit acceptance events
7. `tracking/observer.js` — MutationObserver lifecycle + “relevant mutation” filter
8. `tracking/index.js` — small **facade** that wires modules together and exposes `NS.tracking`
9. `99_entry.js` — startup wiring: watchdog timer, key detector, optional remote POST, initial kick

## When does it “start listening”?
`99_entry.js` runs immediately on page load:
- ensures config is loaded, throttle is applied
- starts an observer watchdog (~10s) which keeps the observer attached even if the editor DOM is replaced
- installs the “first sync key press” detector (default key: `s`)
- starts optional periodic POST to `remoteUrl` (top frame only). The remote host must also be added to `manifest.json` → `host_permissions`.
- triggers an initial `NS.tracking.restart()` (observer attach + initial snapshot)

## Message Types (content → background)
- `log_coordinates`: frequent snapshots of visible ghost elements (throttled + signature deduped)
- `log_keypress`: first sync key press used to anchor the session baseline
- `log_acceptance_check`: per-anchor compare diagnostics used during acceptance detection
- `log_acceptance`: emitted when acceptance is determined true

## Acceptance detection (core idea)
The content script is the only place that can reliably answer “was it accepted?” because it can read the live editor DOM:
- while ghosts are visible, capture the ghost text blocks (normalized, anchored by line “top” position)
- when ghosts disappear, wait a short “stable absence” window
- then collect current editor text from the anchor downward and check whether the ghost snapshot appears near the start

The background later **matches** acceptance to suggestion groups using the IA cache’s notion of the “current primary root” (see `src/background/README.md`).


