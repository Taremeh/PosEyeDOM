# `src/background` — MV3 Service Worker (Storage + Grouping + Matching)

This directory contains the **Manifest V3 background service worker** logic. The manifest marks it as an ES module (`"type": "module"`), so files in here use `import`/`export`.

Entry points:
- `background.js` (repo root): tiny shim that imports `initBackground()`
- `src/background/index.js`: composes the modules below

## Responsibilities
- Own and initialize **IndexedDB** (`DivLoggerDB`)
- Receive events from the content script and persist them (`logs`)
- Incrementally group raw snapshots into **suggestion records** (IAS cache)
- Maintain acceptance matching state (persist accepted suggestion “roots”)
- Serve popup requests (`get_status`, `get_ia_summary`, exports, clear DB, etc.)
- Cleanup detached popup windows on startup/install

## Data model (IndexedDB)
Database: `DivLoggerDB`
- `logs`: append-only raw events (coordinates snapshots + acceptance/key events)
- `ias`: closed suggestion records (rectangles with start/end)
- `ias_meta`: one record under key `"state"` holding incremental state:
  - `baseEpochMs`: baseline epoch for relative time conversion
  - `lastProcessedIso`: high-watermark log timestamp processed into IAS state
  - `labelState`: label assignment state (root labels like `autolabel_1`)
  - `activeRecords`: currently visible/open records carried across incremental updates
  - `acceptedRoots`: array of root labels that were accepted
  - `lastPrimaryRoot`: background’s best guess of the “current/most recent” suggestion root (used for matching acceptance)

## How raw logs become suggestions (IAS cache)
Implemented in `src/background/storage/iasCache.js`:
1. Read incremental state from `ias_meta`
2. Read `logs`, filter those newer than `lastProcessedIso`
3. Convert timestamps to **relative ms** using `baseEpochMs`
   - Prefer the first `log_keypress` timestamp (“First 's' key press logged”)
   - Otherwise fall back to first log timestamp
4. Maintain an `activeRecords` map keyed by “identity” (merged HTML + shape) and “position key”
5. When a record key disappears, close it and append it to `ias`
6. Provide `get_ia_summary` as “closed + still-active” with acceptance annotation

## Acceptance matching (event → suggestion)
Acceptance detection emits `log_acceptance` from the content script, but the *content script does not know* the IA grouping labels.

So the background matches acceptance like this:
1. On `log_acceptance`, call `updateIasCache()` first (ensures meta is current).
2. Read `ias_meta.lastPrimaryRoot` (the root label deemed “current primary”).
3. Add that root label to `ias_meta.acceptedRoots`.
4. When building summaries, mark closed records with `accepted: true/false` based on `acceptedRoots`
   - Active records use `accepted: null` (“pending”) because they are still visible.

## Submodules
- `storage/db.js`: IndexedDB init + raw logs store helpers + clear DB
- `storage/config.js`: cached background config from `chrome.storage.sync`
- `storage/iasCache.js`: incremental grouper + summary builder + acceptance matching persistence
- `workers/messageRouter.js`: `chrome.runtime.onMessage` routing (single source of truth for message types)
- `windows/popupCleanup.js`: closes stale detached popup windows on startup/install


