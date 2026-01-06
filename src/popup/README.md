# `src/popup` — Dashboard UI (Exports + Live Summary)

This directory contains the popup UI logic. `popup.html` loads these scripts in order (no build step).

## Responsibilities
- Render the **Live IA summary** by calling the background (`get_ia_summary`)
- Export raw logs (`DivLoggerDB.logs`)
- Export IA + HTML (asks the content script to compute IA/HTML, then enriches acceptance via background summary)
- Provide settings UI and trigger extension + tab reloads
- Support “Detach” (open popup as a separate window)

Note: if you configure a **Remote URL**, you must also add the remote host to `manifest.json` → `host_permissions`.

## Script modules
- `00_namespace.js`: shared namespace (`globalThis.__POSEYEDOM.popup`)
- `05_settings.js`: settings load/save/reset; triggers reload of extension + github.dev tabs
- `10_db.js`: IndexedDB reads of raw logs (`fetchLogs()`)
- `20_download.js`: download helpers (`downloadText`, `downloadJSON`, `exportLogs`)
- `30_tabs.js`: locate a `github.dev` tab and “reattach” tracking
- `40_export_ia_html.js`: IA/HTML export pipeline:
  - reads raw logs
  - sends `compute_ia_html_from_logs` to the content script
  - if needed, reinjects the content bundle and retries
  - enriches `html_{participant}.json` with acceptance info using `get_ia_summary`
- `50_ia_summary.js`: groups records by root label and renders the expandable table + preview
- `60_status.js`: polls background `get_status` to update DB/Tracking dots
- `99_entry.js`: wires DOM event handlers, starts periodic refresh timers

## “Export IA + HTML” flow
1. Popup reads raw logs from IndexedDB.
2. Popup asks the content script to compute IA + HTML via `compute_ia_html_from_logs`.
3. Popup downloads `output_{participant}.ias`.
4. Popup fetches `get_ia_summary` from the background to learn which suggestion roots were accepted.
5. Popup downloads `html_{participant}.json` with `{ rootLabel: { content, accepted } }`.


