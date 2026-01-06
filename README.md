## PosEyeDOM — Suggestion Tracker

PosEyeDOM is a Chrome/Edge MV3 extension that tracks inline code suggestion overlays in the Monaco editor on `github.dev`. It logs suggestion geometry over time, detects acceptance events, and provides a live dashboard with one‑click exports for IA (.ias) and HTML mapping.

---

### How it Works (High Level)
PosEyeDOM is three parts that communicate via `chrome.runtime` messages and a shared IndexedDB database (`DivLoggerDB`):

- **Content script (runs on `github.dev`)**: watches the Monaco editor DOM for “ghost text” overlays, logs their geometry snapshots, and detects whether a suggestion was accepted.
- **Background service worker**: receives logs from the content script, stores them in IndexedDB, incrementally groups raw snapshots into **suggestion “records”** (IAS cache), and maintains acceptance state.
- **Popup dashboard**: reads logs for export, requests IA/HTML computation, and renders the live grouped summary using the background’s cached IA summary.

If you want deeper docs per module, see:
- `src/content/README.md`
- `src/background/README.md`
- `src/popup/README.md`

---

### Tracking Lifecycle (When does it start listening?)
- **Script injection**: `manifest.json` loads the content bundle at `document_start` on `*://*.github.dev/*` and in **all frames**.
- **Startup wiring**: `src/content/99_entry.js` runs immediately and:
  - Loads config from `chrome.storage.sync`
  - Starts a watchdog timer (every ~10s) that ensures the `MutationObserver` is attached (editor DOM can be replaced)
  - Installs a “first sync key press” listener (default key: `s`)
  - Starts optional periodic remote log POST (top frame only) if `remoteUrl` is configured

---

### Raw Logs (What is stored?)
All raw events are stored in IndexedDB `DivLoggerDB` object store `logs`.

Main message/event types:
- **`log_coordinates`** (content → background): a snapshot of currently visible ghost elements.
  - Stored as `{ timestamp, coordinates: { coordinates: [...], signature, frame, ... } }`
  - Background dedupes bursty identical snapshots per `(tabId, frameId)` for ~500ms.
- **`log_keypress`** (content → background): first “sync key” press to establish a stable session baseline.
- **`log_acceptance_check`** (content → background): debug/trace checks while determining acceptance.
- **`log_acceptance`** (content → background): emitted when acceptance detection concludes “accepted”.

Notes:
- Coordinates are recorded frequently, but throttled (`throttleMs`) and deduped.
- “Empty snapshot” events (no coordinates) are intentionally logged when a suggestion disappears (including focus-loss scenarios).

---

### Grouping Raw Logs into Suggestions (IA / IAS cache)
The background maintains an **incremental cache** of suggestion records in IndexedDB stores:
- `ias`: **closed** suggestion rectangles with start/end
- `ias_meta`: incremental state (baseline epoch, active records, label state, accepted roots, etc.)

The grouping pipeline is:
1. Background reads new `logs` since `ias_meta.lastProcessedIso`
2. It converts timestamps to **relative milliseconds** using `baseEpochMs`
   - Prefer baseline from the first `log_keypress` event (“First 's' key press logged”)
   - Otherwise fall back to the first log timestamp
3. Each snapshot becomes either:
   - **single** record (one ghost element) or
   - **multi** record (multiple ghost elements merged top→bottom into one merged HTML + bounding box)
4. Records are keyed by “base identity” (HTML/shape) + “position key” (e.g. y or ys list)
5. The grouper keeps a map of **active records**; when a key disappears, it closes that record and writes it to `ias`
6. The popup requests `get_ia_summary` to receive a combined view of closed + still-active records

This is what powers:
- the **Live IA summary** table in the popup
- acceptance “matching” (see below)

---

### Acceptance Detection (How does it decide accepted vs rejected?)
Acceptance detection happens in the **content script** because it needs the live editor DOM:
1. While ghost text is visible, the content script captures a **snapshot** of the ghost text blocks (normalized text, anchored by editor line “top” positions).
2. When ghosts disappear, it waits for a short stability window (~150ms) (to avoid transient DOM churn).
3. It then collects current editor text from the anchor line downward and checks whether the previously-captured ghost text appears **near the start** of the text (\(< 1200 chars\) by default).
4. For each anchor it emits a `log_acceptance_check` and if **any** anchor matches, it emits `log_acceptance`.

Important semantics:
- If a suggestion disappears due to **window blur** or **document hidden**, the content script forces an empty snapshot and resets state so it is treated as “not accepted”.
- “Accepted” here is strict “verbatim insertion”; partial edits may not match.

---

### Matching Acceptance Events to Suggestions (How does it mark the right suggestion?)
Acceptance is persisted in the background at the **suggestion root label** level (`autolabel_N`):
1. On `log_acceptance`, the background first runs `updateIasCache()` so its `ias_meta.lastPrimaryRoot` is up-to-date.
2. It then adds that root label to `ias_meta.acceptedRoots`.
3. When the popup requests `get_ia_summary`, the background annotates closed records with:
   - `accepted: true/false` for closed records
   - `accepted: null` for active records (still visible → “pending”)

This avoids incorrectly marking the “next visible suggestion” as accepted and keeps acceptance stable across rerenders.

---

### Highlights
- **Live summary**: Auto‑updating groups of suggestion appearances with durations, preview, and basics.
- **Precise geometry**: x, y, width, height per occurrence, plus start/end and total durations.
- **Acceptance‑aware**: Flags groups where suggestions were actually accepted.
- **One‑click export**: Generate `output_{participant}.ias` and `html_{participant}.json`.
- **Raw logs**: Inspect/download exact logs from IndexedDB.
- **Detached dashboard**: Pop out the popup into a standalone window for long sessions.
- **Configurable**: Selectors, throttle, offsets, error margins, and optional remote POST.

---

### Compatibility
- **Browsers**: Chrome/Chromium, Microsoft Edge (Manifest V3)
- **Sites**: Runs on `*://*.github.dev/*`

---

### Install (Load Unpacked)
1. Open extensions: `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
2. Enable Developer mode.
3. Click “Load unpacked” and select this repo folder.
4. Pin the extension; click the toolbar icon to open the dashboard.

Tip: Use ↗ “Detach” in the popup to open a standalone dashboard window.

---

### Quick Start
1. Open any GitHub repo and press `.` to launch `github.dev`, or open a `github.dev` URL.
2. Open the extension popup. Confirm status dots:
   - DB: Green indicates IndexedDB is connected.
   - Tracking: Green indicates logs have been recorded recently.
3. In Home, set a Participant ID (e.g., `040301`). Optionally set “Sync Key Offset (ms)”.
4. Work in the editor until suggestions appear; the Live Summary will update automatically.
5. Click “Export IA + HTML” to download:
   - `output_{participant}.ias` — rectangles with timings and labels.
   - `html_{participant}.json` — HTML snapshots per label and accepted flag.

---

### Exports
- **IA (.ias)**: Tab‑separated rectangles per appearance with start/end times; labels like `autolabel_1`, `autolabel_1_1`, etc.
- **HTML (JSON)**: `{ [label]: { content: mergedOuterHTML, accepted: boolean } }` at the root label level.
- **Logs (JSON)**: Full raw log dump for auditing or custom processing.

Notes:
- Labels are stable within a session; suffixes (`_1`, `_2`) indicate position changes.
- Timestamps are relative to session baseline; optional Sync Key Offset applies if a sync key press is present.
- Acceptance is tracked at the root label level and reflected in JSON; IA remains geometry/timing.

---

### Settings (Overview)
- **Light mode**: Dashboard theme only.
- **Sync key** (default `s`): Press once to anchor timing.
- **Query selectors**: Default targets Monaco ghost text on `github.dev`.
- **Remote URL**: Optionally POST full logs as JSON every ~10s. Ensure CORS and large payload support. Also add the remote host to `manifest.json` → `host_permissions`.
- **Throttle (ms)**: Logging interval; lower = more detail, higher = less overhead (default 200ms).
- **Window offset (px)**: Vertical offset applied to `y` to account for site chrome (default 91px).
- **Error margin H/V (px)**: Extra padding around detected rectangles (defaults 44/22).

Saving settings reloads the extension and relevant `github.dev` tabs.

---

### Troubleshooting
- **Status dots red**: Reload the extension (Save & Restart) or re‑open the popup; ensure you’re on a `github.dev` page with the editor visible.
- **Export IA says no `github.dev` tab**: Focus an active `github.dev` tab and retry.
- **Vertical misalignment**: Adjust Window offset in small steps around 91.
- **Boxes clip content**: Increase Error margin H/V.
- **Live summary empty**: Verify selectors and throttle; ensure suggestions are visible.
- **Remote POST failing**: Check CORS, server availability, URL, and payload size handling.
- **Acceptance not detected**: Only verbatim acceptance is recognized; partial edits may not match.

---

### Privacy
- Data is stored locally in IndexedDB by default (`DivLoggerDB`).
- If a Remote URL is set, periodic full log POSTs are sent as JSON to that endpoint.
- Captured HTML may include code fragments. Use responsibly and obtain consent where required.

---

### Development
- Manifest V3 with background **service worker (ES module)**.
- Content script runs at `document_start`, `all_frames: true` on `github.dev` (loaded as an ordered multi-file bundle).
- IndexedDB stores: `logs`, `ias`, `ias_meta`. “Clear Database” clears all.
- Detached window feature manages its own popup windows and closes stale ones on startup.

---

### Code Structure (Modular)
- **Background (MV3 service worker)**: `background.js` → `src/background/index.js`
  - `src/background/storage/*`: IndexedDB + IA cache/meta
  - `src/background/workers/*`: message routing (`chrome.runtime.onMessage`)
  - `src/background/windows/*`: detached popup window cleanup
- **Content script bundle** (loaded via `manifest.json`): `src/content/*`
  - `00_namespace.js`: shared namespace + state
  - `10_utils.js`: shared helpers (throttle, safe messaging, DOM helpers)
  - `20_ia_computer.js`: IA/HTML computation + `compute_ia_html_from_logs` listener
  - `config/index.js`: storage-backed config + settings update handling
  - `tracking/*`: observer + logging + acceptance detection (see `src/content/tracking/README.md`)
  - `99_entry.js`: startup wiring/timers
- **Popup bundle** (loaded via `popup.html`): `src/popup/*`
  - `05_settings.js`: settings + reload orchestration
  - `10_db.js`: IndexedDB log reads
  - `40_export_ia_html.js`: IA/HTML export pipeline (incl. reinjection of content bundle)
  - `50_ia_summary.js`: live summary rendering
  - `60_status.js`: status polling
  - `99_entry.js`: UI wiring + periodic refresh
