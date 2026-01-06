# `src/background/storage` — IndexedDB + IA Cache

## Files
- `db.js`
  - Opens/initializes `DivLoggerDB` (schema v2)
  - Writes raw `logs`
  - Clears `logs`, `ias`, `ias_meta` (and reinitializes baseline meta state)
- `config.js`
  - Reads background-relevant settings from `chrome.storage.sync`
  - Exposes a small cached accessor (`bgConfig.get()`) so IA cache can use offsets/margins without re-reading storage constantly
- `iasCache.js`
  - The incremental “grouper” that turns raw coordinate snapshots into suggestion records
  - Stores closed records in `ias`
  - Stores incremental state in `ias_meta`
  - Exposes:
    - `updateIasCache()`: process new logs since last high-watermark
    - `getIasSummary()`: merged view of closed + active records, with acceptance annotation
    - `markAcceptanceAgainstPrimaryRoot()`: persists acceptance by marking the current root label as accepted
    - `getStatus()`: DB connectivity + last log age + last processed timestamp

## Why the cache exists
The popup needs a fast “live summary” without reprocessing the entire raw log stream every tick. The background keeps:
- **active records** (still visible suggestions) in `ias_meta`
- **closed records** (no longer visible) in `ias`

Then `get_ia_summary` is cheap: it reads `ias` + the active records and returns a compact list to render.


