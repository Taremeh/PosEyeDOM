## Privacy Policy for PosEyeDOM

**Contact:** tarek.alakmeh@uzh.ch (or via GitHub Issues in this repository)

### Overview

PosEyeDOM is a Chrome/Edge extension that runs on `github.dev` and tracks inline code suggestion overlays (ghost text) in the Monaco editor. It logs suggestion geometry over time, detects acceptance events, and provides exports (IA and HTML mapping) for analysis.

This Privacy Policy explains what data the extension processes, where it is stored, and when it may be transmitted.

### Scope

This policy applies to PosEyeDOM and its in extension UI (popup/dashboard) and background processes. It does not apply to GitHub, Microsoft, your browser vendor, or any third party services you use on `github.dev`.

### Data the extension processes

PosEyeDOM may process the following categories of data when you use it on `github.dev`.

#### Suggestion overlay and layout data

* Geometry snapshots of suggestion overlay elements (for example x/y position, width/height, and timing)
* Session timing signals (for example a first “sync key” press event used to anchor timestamps)
* Frame identifiers and minimal technical context needed to associate logs with the correct page/frame

#### Content data (may include code fragments)

* For acceptance detection, the extension compares previously captured ghost text with editor text near the anchor line to determine whether a suggestion was inserted verbatim
* Exports may include merged HTML snapshots of ghost text overlays, which can contain code fragments visible in the suggestion overlay

#### Configuration data

* Settings loaded from browser extension storage (for example `chrome.storage.sync`) and may include parameters such as selectors, throttle interval, offsets, and an optional Remote URL

### Where data is stored

#### Local storage (default)

By default, PosEyeDOM stores logs locally in your browser using IndexedDB (for example `DivLoggerDB` and its stores for raw logs and derived caches).

#### Remote transmission (disabled by default, optional)

If you configure a **Remote URL**, the extension can periodically send logs as JSON to that endpoint (top frame only). If no Remote URL is set, the extension does not send logs to any server operated by the maintainer.

**Important:** The remote endpoint is the one you specify. Its operator (you or your institution, for example) is responsible for how it stores and secures any received data.

### How data is used

The extension uses the processed data to:

* Build a live dashboard of suggestion appearances (durations, grouping, and acceptance status)
* Generate exports (IA rectangles with timing and an HTML mapping JSON)
* Support debugging and auditing via raw log export

PosEyeDOM does not use the data for advertising, behavioral profiling, or cross site tracking.

### Sharing and disclosure

* **No sale of data:** The maintainer does not sell user data.
* **No third party analytics by default:** PosEyeDOM does not include third party analytics by default.
* **Remote URL sharing (user enabled):** If enabled, logs are disclosed only to the remote endpoint you configure.
* **Exports:** When you export files, they are saved to your device. Any subsequent sharing of exported files is controlled by you.

### Retention

* Local logs remain in IndexedDB until you delete them (for example using any “Clear Database” or similar functionality) or uninstall the extension.
* If you enable Remote URL logging, retention is determined by the remote endpoint operator’s policies.

### Security

The extension stores data locally in the browser’s extension storage mechanisms. No system is risk free. You should treat captured content as potentially sensitive, especially because captured HTML may include code fragments.

If you enable remote logging:

* Prefer HTTPS
* Restrict access to the receiving server
* Avoid logging in environments where code or secrets may be visible in suggestions

### Your choices and controls

You can:

* Use the extension without remote transmission by leaving the Remote URL unset
* Clear local data by deleting the extension’s IndexedDB data (and using any in extension clear/reset features if provided)
* Disable or uninstall the extension at any time

### Legal bases (optional, for GDPR or Swiss FADP)

If you are using PosEyeDOM in a study or workplace setting, you (or your institution) may be the data controller for any collected logs and exports. Common legal bases include consent and legitimate interests, depending on context. Add your institution specific language here.

### Children’s privacy

PosEyeDOM is not directed to children and is intended for developer tooling on `github.dev`.

### Changes to this policy

We may update this policy from time to time. Material changes will be reflected by updating the effective date and publishing the new version in this repository.

### Contact

For privacy questions or requests:

* Email: tarek.alakmeh@uzh.ch
* Or open an issue on this GitHub repository
