## PosEyeDOM — Suggestion Tracker

PosEyeDOM is a Chrome/Edge MV3 extension that tracks inline code suggestion overlays in the Monaco editor on `github.dev`. It logs suggestion geometry over time, detects acceptance events, and provides a live dashboard with one‑click exports for IA (.ias) and HTML mapping.

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
3. Click “Load unpacked” and select the `div-logger-extension/` folder in this repo.
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
- **Remote URL**: Optionally POST full logs as JSON every ~10s. Ensure CORS and large payload support.
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
- Manifest V3 with background service worker.
- Content script runs at `document_start`, `all_frames: true` on `github.dev`.
- IndexedDB stores: `logs`, `ias`, `ias_meta`. “Clear Database” clears all.
- Detached window feature manages its own popup windows and closes stale ones on startup.
