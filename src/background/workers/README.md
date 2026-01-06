# `src/background/workers` — Message Routing

## `messageRouter.js`
This module is the **single source of truth** for background message handling.

It listens on `chrome.runtime.onMessage` and routes:
- **From content script**
  - `log_coordinates` → persist to `logs` (with dedupe per tab+frame)
  - `log_keypress` → persist to `logs`
  - `log_acceptance` → persist + mark acceptance against current primary root
  - `log_acceptance_check` → append into a rolling buffer in `ias_meta`
- **From popup**
  - `view_logs` / `export_logs` → return all logs
  - `clear_database` → clears `logs`, `ias`, `ias_meta`
  - `force_update_ias` → runs incremental cache update
  - `get_ia_summary` → returns grouped summary (closed + active)
  - `get_status` → DB connectivity + last log age
  - `settings_updated` → refresh background config cache

Why this matters:
- Keeping routing in one file makes it easy to audit all supported message types and how they affect storage/state.


