function openDatabase() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("DivLoggerDB");
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function fetchLogs() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction("logs", "readonly");
      const store = transaction.objectStore("logs");
      const logs = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          logs.push(cursor.value);
          cursor.continue();
        } else {
          resolve(logs);
        }
      };
      cursorRequest.onerror = (event) => reject(event.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function clearDatabaseLocalOnly() {
  openDatabase().then(db => {
    const transaction = db.transaction("logs", "readwrite");
    const store = transaction.objectStore("logs");
    const clearRequest = store.clear();
    clearRequest.onsuccess = () => {
      console.log("Database cleared");
      document.getElementById("logs").textContent = "Database cleared!";
    };
    clearRequest.onerror = (event) => {
      console.error("Error clearing database:", event.target.error);
    };
  });
}

function displayLogs(logs) {
  const pre = document.getElementById("logs");
  if (!logs || logs.length === 0) {
    pre.textContent = "No logs available. Open a GitHub Codespace to start tracking suggestions.";
  } else {
    pre.textContent = JSON.stringify(logs, null, 2);
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportLogs(logs) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `div_logs_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Ask the active tab's content script to compute IA+HTML, given the logs we have locally in popup
async function computeAndExportIAHTML() {
  try {
    const logs = await fetchLogs();
    const participantId = (document.getElementById("participant-id").value || "session").trim();
    const offsetMs = Number(document.getElementById("offset-ms").value || 0);

    function pickGithubDevTab(cb) {
      try {
        chrome.tabs.query({ url: ["*://*.github.dev/*"] }, (tabs) => {
          if (chrome.runtime.lastError) { cb(null); return; }
          if (tabs && tabs.length) {
            const activeFocused = tabs.find(t => t.active && t.highlighted) || null;
            const activeAny = tabs.find(t => t.active) || null;
            cb(activeFocused || activeAny || tabs[0]);
          } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (t2) => {
              if (t2 && t2.length && t2[0].url && t2[0].url.includes("github.dev")) cb(t2[0]); else cb(null);
            });
          }
        });
      } catch (_) { cb(null); }
    }

    pickGithubDevTab((tab) => {
      if (!tab) {
        console.error("No github.dev tab found to send compute request to.");
        alert("No github.dev tab found. Open your github.dev tab and try again.");
        return;
      }
      const tabId = tab.id;
      const errH = Math.max(0, Number(document.getElementById("cfg-err-h").value || DEFAULT_SETTINGS.errorMarginH));
      const errV = Math.max(0, Number(document.getElementById("cfg-err-v").value || DEFAULT_SETTINGS.errorMarginV));
      const winOff = Math.max(0, Number(document.getElementById("cfg-window-offset").value || DEFAULT_SETTINGS.browserWindowOffset));
      const msg = { type: "compute_ia_html_from_logs", logs, offsetMs, errorMarginH: errH, errorMarginV: errV, browserWindowOffset: winOff };

      function handleResponse(response) {
        if (!response || !response.ok) {
          const errMsg = (response && response.error) || "Unknown error computing IA/HTML.";
          console.error("IA/HTML compute error:", errMsg);
          alert(`IA/HTML compute error: ${errMsg}`);
          return;
        }
        const { iasText, htmlMapping } = response;
        // Always download IAS text immediately
        downloadText(`output_${participantId}.ias`, iasText);

        // Helper to map label -> root
        function rootOf(label) {
          const m = String(label || "").match(/^(autolabel_\d+)/);
          return m ? m[1] : String(label || "");
        }
        // Build the HTML export keyed by root with { content, accepted }
        function buildHtmlExport(mapping, summary) {
          const out = {};
          const acceptedRoots = new Set();
          try {
            if (summary && summary.ok && Array.isArray(summary.records)) {
              summary.records.forEach(r => { try { if (r && r.accepted) acceptedRoots.add(rootOf(r.label)); } catch (_) {} });
            }
          } catch (_) {}
          try {
            Object.keys(mapping || {}).forEach(label => {
              const root = rootOf(label);
              if (!out[root]) {
                out[root] = { content: mapping[label], accepted: acceptedRoots.has(root) };
              }
            });
          } catch (_) {}
          return out;
        }

        // Try to enrich with acceptance from background summary; fallback to all false
        try {
          chrome.runtime.sendMessage({ type: "get_ia_summary" }, (summary) => {
            if (chrome.runtime.lastError || !summary || summary.ok !== true) {
              const fallback = buildHtmlExport(htmlMapping, null);
              downloadJSON(`html_${participantId}.json`, fallback);
              console.warn("Falling back to export without acceptance enrichment", chrome.runtime.lastError ? chrome.runtime.lastError.message : "no summary");
              return;
            }
            const enriched = buildHtmlExport(htmlMapping, summary);
            downloadJSON(`html_${participantId}.json`, enriched);
          });
        } catch (_) {
          const fallback = buildHtmlExport(htmlMapping, null);
          downloadJSON(`html_${participantId}.json`, fallback);
        }
        console.log("IA and HTML mapping exported.");
      }

      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Initial message failed, attempting to inject content script and retry:", chrome.runtime.lastError.message);
          try {
            chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }, () => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, msg, (resp2) => {
                  if (chrome.runtime.lastError) {
                    console.error("Retry after inject failed:", chrome.runtime.lastError.message);
                    alert("Could not reach content script. Make sure the github.dev tab is open.");
                    return;
                  }
                  handleResponse(resp2);
                });
              }, 50);
            });
          } catch (e) {
            console.error("executeScript failed:", e);
            alert("Could not reach content script. Make sure the github.dev tab is open.");
          }
          return;
        }
        handleResponse(response);
      });
    });
  } catch (err) {
    console.error("Failed to compute/export IA+HTML:", err);
    alert(`Failed to export IA/HTML: ${err && err.message ? err.message : String(err)}`);
  }
}

// --- Live IA Summary rendering ---
const expandState = new Set(); // stores root labels currently expanded

function groupByRoot(records) {
  const groups = new Map();
  for (const r of records || []) {
    const label = r.label || "";
    const m = label.match(/^(autolabel_\d+)/);
    const root = m ? m[1] : label;
    let g = groups.get(root);
    if (!g) {
      g = { root, children: [], start: r.start, end: r.end };
      groups.set(root, g);
    }
    g.children.push(r);
    if (typeof r.start === 'number' && r.start < g.start) g.start = r.start;
    if (typeof r.end === 'number' && r.end > g.end) g.end = r.end;
  }
  // Sort roots by first start
  const arr = Array.from(groups.values());
  arr.sort((a, b) => a.start - b.start);
  // Sort children within root by start
  arr.forEach(g => g.children.sort((a, b) => a.start - b.start));
  return arr;
}

function msToSeconds(ms) {
  return (Math.max(0, Number(ms || 0)) / 1000).toFixed(2);
}

function renderIASummary(records) {
  const tbody = document.getElementById("ia-tbody");
  const title = document.getElementById("ia-summary-title");
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  const groups = groupByRoot(records);

  // title badge with group count and total duration
  if (title) {
    const totalDurationMs = (groups || []).reduce((acc, g) => acc + Math.max(0, Number(g.end || 0) - Number(g.start || 0)), 0);
    title.innerHTML = `Live IA summary <span class="badge">${groups.length}</span> <span class="pill mono">${msToSeconds(totalDurationMs)}s</span>`;
  }

  if (!groups || groups.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "small muted";
    td.textContent = "No data yet…";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  groups.forEach((g, idx) => {
    const rootId = g.root;
    const isExpanded = expandState.has(rootId);
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => {
      if (expandState.has(rootId)) expandState.delete(rootId); else expandState.add(rootId);
      requestIASummaryAndRender();
    });

    const tdIdx = document.createElement("td");
    tdIdx.innerHTML = `<span class="badge">${idx + 1}</span>`;
    tr.appendChild(tdIdx);

    const tdLabel = document.createElement("td");
    const count = g.children.length;
    const caret = isExpanded ? "▼" : "▶";
    tdLabel.innerHTML = `<span class="mono">${rootId}</span><span class="badge">${count}</span><span class="caret">${caret}</span>`;
    tr.appendChild(tdLabel);

    const tdDur = document.createElement("td");
    const durationMs = Math.max(0, Number(g.end || 0) - Number(g.start || 0));
    const groupAccepted = g.children.some(c => !!c.accepted);
    const chipColor = groupAccepted ? "rgba(45,164,78,0.15)" : "rgba(207,34,46,0.15)";
    const chipBorder = groupAccepted ? "rgba(45,164,78,0.35)" : "rgba(207,34,46,0.45)";
    const chipText = groupAccepted ? "#91d1a7" : "#ffb1b8";
    tdDur.innerHTML = `<span class="chip mono" style="background:${chipColor};border-color:${chipBorder};color:${chipText}">${msToSeconds(durationMs)}s</span>`;
    tr.appendChild(tdDur);

    tbody.appendChild(tr);

    if (isExpanded) {
      // Removed initial spacer row to avoid empty space

      // Render only the first occurrence preview
      const occurrences = g.children;
      const child = occurrences[0];
      const ctr = document.createElement("tr");
      const rowCell = document.createElement("td"); rowCell.colSpan = 3; rowCell.style.padding = "6px 0";
      // Two-column layout inside the single cell: left for vertical ruler, right for content
      const rowWrap = document.createElement("div");
      rowWrap.style.display = "grid";
      rowWrap.style.gridTemplateColumns = "48px 1fr";
      rowWrap.style.columnGap = "6px";
      rowWrap.style.alignItems = "start";
      rowWrap.style.width = "100%";
      const leftCol = document.createElement("div");
      leftCol.style.position = "relative";
      leftCol.style.width = "48px";
      leftCol.style.display = "block";
      const rightCol = document.createElement("div");
      rightCol.style.minWidth = "0";
      // Preview content block reused
      const box = document.createElement("div");
      box.style.position = "relative";
      box.style.display = "block";
      box.style.width = "auto";
      const content = document.createElement("div");
      content.className = "html-preview";
      content.style.display = "inline-block";
      content.style.whiteSpace = "pre-wrap";
      content.style.width = "auto";
      content.style.maxWidth = "100%";
      try { content.innerHTML = child.html || ""; } catch (_) { content.textContent = child.html || ""; }
      const hsvgHolder = document.createElement("div");
      hsvgHolder.className = "hsvg-holder";
      hsvgHolder.style.width = "auto";
      box.appendChild(content);
      box.appendChild(hsvgHolder);

      // Add title above the suggestion preview
      const previewLabel = document.createElement("div");
      previewLabel.className = "small muted";
      previewLabel.style.margin = "8px 0 6px";
      previewLabel.style.width = "100%";
      previewLabel.style.fontWeight = "600";
      previewLabel.style.fontSize = "12px";
      previewLabel.textContent = "Suggestion Preview";

      // Left vertical ruler holder
      const vsvgHolder = document.createElement("div");
      vsvgHolder.style.position = "relative";
      vsvgHolder.style.width = "48px";
      vsvgHolder.style.height = "0px";
      leftCol.appendChild(vsvgHolder);

      // Draw measurement arrows after paint
      requestAnimationFrame(() => {
        try {
          // Align vertical ruler with top of preview box by offsetting for the preview label height
          const labelRect = previewLabel && previewLabel.getBoundingClientRect ? previewLabel.getBoundingClientRect() : null;
          const labelHeight = labelRect ? labelRect.height : 0;
          const labelMarginTop = 8, labelMarginBottom = 6; // keep in sync with previewLabel.style.margin
          vsvgHolder.style.marginTop = `${labelHeight + labelMarginTop + labelMarginBottom}px`;

          const w = Math.max(0, content.clientWidth || 0);
          const h = Math.max(0, content.clientHeight || 0);
          // Horizontal (below preview)
          hsvgHolder.innerHTML = "";
          const hsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          hsvg.setAttribute("width", String(w));
          hsvg.setAttribute("height", "22");
          const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          hLine.setAttribute("x1", "0"); hLine.setAttribute("y1", "10");
          hLine.setAttribute("x2", String(w)); hLine.setAttribute("y2", "10");
          hLine.setAttribute("stroke", "#6e7681"); hLine.setAttribute("stroke-width", "1");
          const hLeft = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hLeft.setAttribute("d", "M6 6 L0 10 L6 14"); hLeft.setAttribute("stroke", "#6e7681"); hLeft.setAttribute("fill", "none");
          const hRight = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hRight.setAttribute("d", `M${w-6} 6 L${w} 10 L${w-6} 14`); hRight.setAttribute("stroke", "#6e7681"); hRight.setAttribute("fill", "none");
          const hText = document.createElementNS("http://www.w3.org/2000/svg", "text");
          hText.setAttribute("x", String(Math.max(0, w/2))); hText.setAttribute("y", "21");
          hText.setAttribute("text-anchor", "middle"); hText.setAttribute("font-size", "11"); hText.setAttribute("fill", "#8b949e");
          hText.textContent = `${(typeof child.width === 'number' ? child.width.toFixed(2) : String(w))} px`;
          hsvg.appendChild(hLine); hsvg.appendChild(hLeft); hsvg.appendChild(hRight); hsvg.appendChild(hText);
          hsvgHolder.appendChild(hsvg);

          // (moved) Suggestion Meta now rendered in its own full-width row below

          // Vertical (first column), aligned with preview top
          vsvgHolder.innerHTML = "";
          const vsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          vsvg.setAttribute("width", "48"); vsvg.setAttribute("height", String(h));
          const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          vLine.setAttribute("x1", "46"); vLine.setAttribute("y1", "0"); vLine.setAttribute("x2", "46"); vLine.setAttribute("y2", String(h));
          vLine.setAttribute("stroke", "#6e7681"); vLine.setAttribute("stroke-width", "1");
          const vTop = document.createElementNS("http://www.w3.org/2000/svg", "path"); vTop.setAttribute("d", "M44 6 L46 0 L48 6"); vTop.setAttribute("stroke", "#6e7681"); vTop.setAttribute("fill", "none");
          const vBot = document.createElementNS("http://www.w3.org/2000/svg", "path"); vBot.setAttribute("d", `M44 ${h-6} L46 ${h} L48 ${h-6}`); vBot.setAttribute("stroke", "#6e7681"); vBot.setAttribute("fill", "none");
          const vText = document.createElementNS("http://www.w3.org/2000/svg", "text"); vText.setAttribute("x", "42"); vText.setAttribute("y", String(Math.max(12, h/2 - 4))); vText.setAttribute("text-anchor", "end"); vText.setAttribute("font-size", "11"); vText.setAttribute("fill", "#8b949e"); vText.textContent = `${(typeof child.height === 'number' ? child.height.toFixed(2) : String(h))}`;
          const vText2 = document.createElementNS("http://www.w3.org/2000/svg", "text"); vText2.setAttribute("x", "42"); vText2.setAttribute("y", String(Math.max(24, h/2 + 8))); vText2.setAttribute("text-anchor", "end"); vText2.setAttribute("font-size", "11"); vText2.setAttribute("fill", "#8b949e"); vText2.textContent = "px";
          vsvg.appendChild(vLine); vsvg.appendChild(vTop); vsvg.appendChild(vBot); vsvg.appendChild(vText); vsvg.appendChild(vText2);
          vsvgHolder.appendChild(vsvg);
        } catch (e) { console.error("Failed to render measurement", e); }
      });

      rightCol.appendChild(previewLabel);
      rightCol.appendChild(box);
      rowWrap.appendChild(leftCol);
      rowWrap.appendChild(rightCol);
      rowCell.appendChild(rowWrap);
      ctr.appendChild(rowCell);
      tbody.appendChild(ctr);

      // New row: Suggestion Meta (full width), aligned with content column
      const metaRow = document.createElement("tr");
      const metaCell = document.createElement("td"); metaCell.colSpan = 3; metaCell.style.padding = "8px 0 24px 0";
      const metaContainer = document.createElement("div");
      metaContainer.style.width = "100%";
      metaContainer.style.marginLeft = "54px";
      const metaLabel = document.createElement("div");
      metaLabel.className = "small muted";
      metaLabel.style.margin = "8px 0 6px";
      metaLabel.style.width = "100%";
      metaLabel.style.fontWeight = "600";
      metaLabel.style.fontSize = "12px";
      metaLabel.textContent = "Suggestion Meta";
      const metaTable = document.createElement("table");
      metaTable.style.borderCollapse = "collapse";
      metaTable.style.marginTop = "12px";
      metaTable.style.width = "100%";
      const row1 = document.createElement("tr");
      const row1c1 = document.createElement("td"); row1c1.className = "small muted"; row1c1.style.padding = "0 6px 2px 0"; row1c1.textContent = "⌖";
      const row1c2 = document.createElement("td"); row1c2.className = "small muted mono"; row1c2.style.padding = "0 0 2px 0";
      const xyVal = (typeof child.x === 'number' && typeof child.y === 'number') ? `${child.x.toFixed(2)}, ${child.y.toFixed(2)}` : "";
      row1c2.textContent = `x,y ${xyVal} px`;
      row1.appendChild(row1c1); row1.appendChild(row1c2);
      const row2 = document.createElement("tr");
      const row2c1 = document.createElement("td"); row2c1.className = "small muted"; row2c1.style.padding = "0 6px 0 0"; row2c1.textContent = "⏱";
      const row2c2 = document.createElement("td"); row2c2.className = "small muted mono"; row2c2.style.padding = "0";
      const aggStart = occurrences[0].start; const aggEnd = occurrences[occurrences.length - 1].end;
      row2c2.textContent = `${aggStart} → ${aggEnd} ms`;
      row2.appendChild(row2c1); row2.appendChild(row2c2);
      const row3 = document.createElement("tr");
      const row3c1 = document.createElement("td"); row3c1.className = "small muted"; row3c1.style.padding = "0 6px 0 0"; row3c1.textContent = "Accepted";
      const row3c2 = document.createElement("td"); row3c2.className = "small muted mono"; row3c2.style.padding = "0";
      const acceptedChild = g.children.some(c => !!c.accepted);
      row3c2.textContent = acceptedChild ? "true" : "false";
      row3.appendChild(row3c1); row3.appendChild(row3c2);
      metaTable.appendChild(row1); metaTable.appendChild(row2); metaTable.appendChild(row3);
      metaContainer.appendChild(metaLabel);
      metaContainer.appendChild(metaTable);
      metaCell.appendChild(metaContainer);
      metaRow.appendChild(metaCell);
      tbody.appendChild(metaRow);

      // If multiple occurrences, render a line chart of x and y over enumeration
      if (occurrences.length > 1) {
        const xs = occurrences.map(o => (typeof o.x === 'number' ? o.x : 0));
        const ys = occurrences.map(o => (typeof o.y === 'number' ? o.y : 0));
        const n = occurrences.length;
        const chartRow = document.createElement("tr");
        const chartCell = document.createElement("td");
        chartCell.colSpan = 3;
        chartCell.style.padding = "6px 0";
        const chartContainer = document.createElement("div");
        chartContainer.style.width = "100%";
        chartContainer.style.position = "relative";
        // Title above chart, aligned with meta label (offset by first column width)
        const LEFT_OFFSET = 48;
        const title = document.createElement("div");
        title.className = "small muted";
        title.style.margin = "8px 0 6px";
        title.style.marginLeft = `${LEFT_OFFSET}px`;
        title.style.fontWeight = "600";
        title.style.fontSize = "12px";
        title.textContent = `Positional Changes (${n})`;
        chartContainer.appendChild(title);

        const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const H = 160;
        const ML = 40, MR = 12, MT = 10, MB = 52;
        chart.setAttribute("height", String(H));
        chart.style.display = "block";

        function renderChart() {
          // Ensure full container width by measuring after insertion
          const availW = chartContainer.clientWidth || (chartContainer.getBoundingClientRect ? chartContainer.getBoundingClientRect().width : 320) || 320;
          const W = Math.max(LEFT_OFFSET + 280, availW);
          chart.setAttribute("width", String(W));
          chart.setAttribute("viewBox", `0 0 ${W} ${H}`);

          // Clear previous contents
          while (chart.firstChild) chart.removeChild(chart.firstChild);

          const plotW = W - ML - MR; const plotH = H - MT - MB;
          const minXVal = Math.min(...xs), maxXVal = Math.max(...xs);
          const minYVal = Math.min(...ys), maxYVal = Math.max(...ys);
          const minVal = Math.min(minXVal, minYVal), maxVal = Math.max(maxXVal, maxYVal);
          const d = (maxVal - minVal) || 1;
          const xPos = (i) => ML + (n === 1 ? plotW/2 : (i * (plotW / (n - 1))));
          const yPos = (v) => MT + plotH - ((v - minVal) / d) * plotH;
          // Axes
          const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "path");
          xAxis.setAttribute("d", `M${ML} ${MT+plotH} L${ML+plotW} ${MT+plotH}`);
          xAxis.setAttribute("stroke", "#30363d"); xAxis.setAttribute("stroke-width", "1");
          chart.appendChild(xAxis);
          const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "path");
          yAxis.setAttribute("d", `M${ML} ${MT} L${ML} ${MT+plotH}`);
          yAxis.setAttribute("stroke", "#30363d"); yAxis.setAttribute("stroke-width", "1");
          chart.appendChild(yAxis);
          // Y ticks (5)
          for (let i = 0; i <= 4; i++) {
            const val = minVal + (d * i / 4);
            const y = yPos(val);
            const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
            tick.setAttribute("x1", String(ML - 4)); tick.setAttribute("y1", String(y));
            tick.setAttribute("x2", String(ML)); tick.setAttribute("y2", String(y));
            tick.setAttribute("stroke", "#30363d"); chart.appendChild(tick);
            const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
            lbl.setAttribute("x", String(ML - 6)); lbl.setAttribute("y", String(y + 4));
            lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("font-size", "10"); lbl.setAttribute("fill", "#8b949e");
            lbl.textContent = Math.round(val).toString(); chart.appendChild(lbl);
          }
          // X enumeration ticks (1..N)
          for (let i = 0; i < n; i++) {
            const x = xPos(i);
            const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
            tick.setAttribute("x1", String(x)); tick.setAttribute("y1", String(MT+plotH));
            tick.setAttribute("x2", String(x)); tick.setAttribute("y2", String(MT+plotH+4));
            tick.setAttribute("stroke", "#30363d"); chart.appendChild(tick);
            const num = document.createElementNS("http://www.w3.org/2000/svg", "text");
            num.setAttribute("x", String(x)); num.setAttribute("y", String(MT+plotH+16));
            num.setAttribute("text-anchor", "middle"); num.setAttribute("font-size", "10"); num.setAttribute("fill", "#8b949e");
            num.textContent = String(i+1); chart.appendChild(num);
          }
          // X and Y lines + points
          let dX = ""; xs.forEach((v,i)=>{ const x=xPos(i), y=yPos(v); dX += (i?" L":"M")+x+" "+y; });
          const pathX = document.createElementNS("http://www.w3.org/2000/svg", "path"); pathX.setAttribute("d", dX); pathX.setAttribute("fill", "none"); pathX.setAttribute("stroke", "#2da44e"); pathX.setAttribute("stroke-width", "2"); chart.appendChild(pathX);
          let dY = ""; ys.forEach((v,i)=>{ const x=xPos(i), y=yPos(v); dY += (i?" L":"M")+x+" "+y; });
          const pathY = document.createElementNS("http://www.w3.org/2000/svg", "path"); pathY.setAttribute("d", dY); pathY.setAttribute("fill", "none"); pathY.setAttribute("stroke", "#58a6ff"); pathY.setAttribute("stroke-width", "2"); chart.appendChild(pathY);
          xs.forEach((v,i)=>{ const cx=xPos(i), cy=yPos(v); const pt=document.createElementNS("http://www.w3.org/2000/svg","circle"); pt.setAttribute("cx",String(cx)); pt.setAttribute("cy",String(cy)); pt.setAttribute("r","2.5"); pt.setAttribute("fill","#2da44e"); chart.appendChild(pt); });
          ys.forEach((v,i)=>{ const cx=xPos(i), cy=yPos(v); const pt=document.createElementNS("http://www.w3.org/2000/svg","circle"); pt.setAttribute("cx",String(cx)); pt.setAttribute("cy",String(cy)); pt.setAttribute("r","2.5"); pt.setAttribute("fill","#58a6ff"); chart.appendChild(pt); });
        }

        chartContainer.appendChild(chart);
        // Legend below chart
        const legend = document.createElement("div");
        legend.className = "small muted";
        legend.style.marginTop = "6px";
        legend.style.marginRight = "8px";
        legend.style.marginBottom = "6px";
        legend.style.display = "flex";
        legend.style.justifyContent = "flex-end";
        legend.style.alignItems = "center";
        legend.style.gap = "16px";
        const legX = document.createElement("div"); legX.style.display = "flex"; legX.style.alignItems = "center"; legX.style.gap = "6px";
        const legXLine = document.createElement("span"); legXLine.style.display = "inline-block"; legXLine.style.width = "14px"; legXLine.style.height = "2px"; legXLine.style.background = "#2da44e";
        const legXText = document.createElement("span"); legXText.className = "mono"; legXText.textContent = "x";
        legX.appendChild(legXLine); legX.appendChild(legXText);
        const legY = document.createElement("div"); legY.style.display = "flex"; legY.style.alignItems = "center"; legY.style.gap = "6px";
        const legYLine = document.createElement("span"); legYLine.style.display = "inline-block"; legYLine.style.width = "14px"; legYLine.style.height = "2px"; legYLine.style.background = "#58a6ff";
        const legYText = document.createElement("span"); legYText.className = "mono"; legYText.textContent = "y";
        legY.appendChild(legYLine); legY.appendChild(legYText);
        legend.appendChild(legX); legend.appendChild(legY);
        chartContainer.appendChild(legend);

        chartCell.appendChild(chartContainer);
        chartRow.appendChild(chartCell);
        tbody.appendChild(chartRow);

        // Render after insertion for correct full width
        requestAnimationFrame(renderChart);
        // Update on resize to keep full width
        const resizeHandler = () => renderChart();
        window.addEventListener("resize", resizeHandler);
        // Clean up if needed when table rerenders
        // Not strictly necessary in popup lifecycle, but safe if DOM replaced
      }
    }
  });
}

// Toggle logs panel
const logsContainer = document.getElementById("logs-container");
const showLogsBtn = document.getElementById("view-logs");
showLogsBtn.addEventListener("click", async () => {
  try {
    const isHidden = logsContainer.classList.contains("hidden");
    if (isHidden) {
      const logs = await fetchLogs();
      displayLogs(logs);
      logsContainer.classList.remove("hidden");
      showLogsBtn.textContent = "Hide Logs";
    } else {
      logsContainer.classList.add("hidden");
      showLogsBtn.textContent = "Show Logs";
    }
  } catch (e) {
    console.error("toggle logs error", e);
  }
});

function requestIASummaryAndRender() {
  try {
    chrome.runtime.sendMessage({ type: "get_ia_summary" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("get_ia_summary error:", chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.ok) {
        console.warn("No IA summary yet");
        return;
      }
      renderIASummary(response.records || []);
    });
  } catch (e) {
    console.error("requestIASummaryAndRender error", e);
  }
}

function tickUpdateIAS() {
  // Ask background to update cache then fetch summary
  try {
    chrome.runtime.sendMessage({ type: "force_update_ias" }, () => {
      if (chrome.runtime.lastError) {
        console.error("force_update_ias error:", chrome.runtime.lastError.message);
      }
      requestIASummaryAndRender();
    });
  } catch (e) {
    console.error("tickUpdateIAS error", e);
  }
}

// --- Status indicators ---
function setDot(id, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("green", "red", "yellow");
  if (color) el.classList.add(color);
}

function pollStatus() {
  // DB + tracking from background
  try {
    chrome.runtime.sendMessage({ type: "get_status" }, (resp) => {
      if (!resp || resp.ok !== true) {
        setDot("dot-db", "red");
        setDot("dot-tracking", "red");
      } else {
        setDot("dot-db", resp.dbConnected ? "green" : "red");
        const age = typeof resp.lastLogAgeMs === 'number' ? resp.lastLogAgeMs : null;
        setDot("dot-tracking", age !== null && age < 10000 ? "green" : "red");
      }
    });
  } catch (_) {
    setDot("dot-db", "red");
    setDot("dot-tracking", "red");
  }
}

// --- Navigation and settings ---
const viewHome = document.getElementById("view-home");
const viewSettings = document.getElementById("view-settings");
const navHome = document.getElementById("nav-home");
const navSettings = document.getElementById("nav-settings");

function showView(which) {
  if (which === "home") {
    viewHome.classList.remove("hidden");
    viewSettings.classList.add("hidden");
    navHome.classList.add("active");
    navSettings.classList.remove("active");
  } else {
    viewSettings.classList.remove("hidden");
    viewHome.classList.add("hidden");
    navSettings.classList.add("active");
    navHome.classList.remove("active");
  }
}

navHome.addEventListener("click", () => showView("home"));
navSettings.addEventListener("click", () => showView("settings"));

const DEFAULT_SETTINGS = {
  theme: "light",
  syncKey: "s",
  selectors: ".ghost-text-decoration, .ghost-text, .ghost-text-decoration-preview",
  remoteUrl: "",
  throttleMs: 200,
  browserWindowOffset: 91,
  errorMarginH: 44,
  errorMarginV: 22
};

function applyTheme(theme) {
  const cls = theme === "light" ? "theme-light" : "";
  document.documentElement.className = cls;
}

function loadSettings() {
  try {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (cfg) => {
      const isLight = (cfg.theme || DEFAULT_SETTINGS.theme) === "light";
      const themeCheckbox = document.getElementById("cfg-theme");
      if (themeCheckbox) themeCheckbox.checked = isLight;
      applyTheme(isLight ? "light" : "dark");
      document.getElementById("cfg-sync-key").value = cfg.syncKey || DEFAULT_SETTINGS.syncKey;
      document.getElementById("cfg-selectors").value = cfg.selectors || DEFAULT_SETTINGS.selectors;
      document.getElementById("cfg-remote-url").value = cfg.remoteUrl || DEFAULT_SETTINGS.remoteUrl;
      document.getElementById("cfg-throttle").value = String(cfg.throttleMs != null ? cfg.throttleMs : DEFAULT_SETTINGS.throttleMs);
      document.getElementById("cfg-window-offset").value = String(cfg.browserWindowOffset != null ? cfg.browserWindowOffset : DEFAULT_SETTINGS.browserWindowOffset);
      document.getElementById("cfg-err-h").value = String(cfg.errorMarginH != null ? cfg.errorMarginH : DEFAULT_SETTINGS.errorMarginH);
      document.getElementById("cfg-err-v").value = String(cfg.errorMarginV != null ? cfg.errorMarginV : DEFAULT_SETTINGS.errorMarginV);
    });
  } catch (e) {
    console.error("loadSettings error", e);
  }
}

// Restore Clear DB, Export IA, and Detach listeners
try {
  document.getElementById("clear-db").addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({ type: "clear_database" }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error("clear_database error:", chrome.runtime.lastError.message);
          return;
        }
        // If logs panel is open, update it
        if (!logsContainer.classList.contains("hidden")) {
          document.getElementById("logs").textContent = "Database cleared!";
        }
        requestIASummaryAndRender();
        pollStatus();
      });
    } catch (e) {
      console.error("clear_database send error", e);
    }
  });

  document.getElementById("export-ia-html").addEventListener("click", computeAndExportIAHTML);

  const detachBtn = document.getElementById("detach-window");
  // Hide detach button when running in a detached window
  try {
    const params = new URLSearchParams(location.search || "");
    if (params.get("detached") === "1") {
      detachBtn.style.display = "none";
    }
  } catch (_) {}
  detachBtn.addEventListener("click", () => {
    try {
      const url = chrome.runtime.getURL("popup.html") + "?detached=1";
      chrome.windows.create({ url, type: "popup", width: 520, height: 720, focused: true }, (w) => {
        try {
          if (w && typeof w.id === 'number') {
            chrome.storage.local.get({ managedPopupWindows: [] }, (res) => {
              try {
                const arr = Array.isArray(res.managedPopupWindows) ? res.managedPopupWindows : [];
                if (!arr.includes(w.id)) arr.push(w.id);
                chrome.storage.local.set({ managedPopupWindows: arr });
              } catch (_) {}
            });
          }
        } catch (_) {}
        // Close the previous window (this popup)
        try { window.close(); } catch (_) {}
      });
    } catch (e) {
      console.error("Failed to detach window", e);
    }
  });
} catch (_) {}

// Helper: fully reload extension and relevant tabs
function fullReloadExtensionAndTabs() {
  try {
    chrome.tabs.query({ url: ["*://*.github.dev/*"] }, (tabs) => {
      try {
        (tabs || []).forEach(t => { try { chrome.tabs.reload(t.id, { bypassCache: true }); } catch (_) {} });
      } catch (_) {}
      // small delay to let tab reloads start, then reload extension
      try { setTimeout(() => { try { chrome.runtime.reload(); } catch (_) {} }, 150); } catch (_) { try { chrome.runtime.reload(); } catch (_) {} }
    });
  } catch (_) {
    try { chrome.runtime.reload(); } catch (_) {}
  }
}

function closeOtherPopupWindowsThen(fn) {
  try {
    chrome.windows.getCurrent({}, (current) => {
      chrome.storage.local.get({ managedPopupWindows: [], closeOnStartup: [] }, (res) => {
        const managed = new Set(Array.isArray(res.managedPopupWindows) ? res.managedPopupWindows : []);
        const closeOnStartup = new Set(Array.isArray(res.closeOnStartup) ? res.closeOnStartup : []);
        if (current && typeof current.id === 'number') closeOnStartup.add(current.id);
        chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, (wins) => {
          const stillManaged = [];
          (wins || []).forEach(w => {
            try {
              if (current && w.id === current.id) return; // do not close our current window now
              let shouldClose = false;
              if (managed.has(w.id)) shouldClose = true;
              const tabs = Array.isArray(w.tabs) ? w.tabs : [];
              const extUrl = chrome.runtime.getURL("popup.html");
              const hasOurPopup = tabs.some(tb => (tb.url || "").indexOf(extUrl) === 0);
              const emptyOrNewTab = tabs.length === 0 || tabs.some(tb => (tb.url || "").startsWith("chrome://") || (tb.url || "").startsWith("about:"));
              if (hasOurPopup || emptyOrNewTab) shouldClose = true;
              if (shouldClose) {
                try { chrome.windows.remove(w.id); } catch (_) {}
              } else {
                if (managed.has(w.id)) stillManaged.push(w.id);
              }
            } catch (_) {}
          });
          try { chrome.storage.local.set({ managedPopupWindows: stillManaged, closeOnStartup: Array.from(closeOnStartup) }); } catch (_) {}
          try { setTimeout(() => { try { fn && fn(); } catch (_) {} }, 120); } catch (_) { try { fn && fn(); } catch (_) {} }
        });
      });
    });
  } catch (_) { try { fn && fn(); } catch (_) {} }
}

function saveSettings() {
  const isLight = !!document.getElementById("cfg-theme").checked;
  const theme = isLight ? "light" : "dark";
  const syncKey = (document.getElementById("cfg-sync-key").value || "").trim() || DEFAULT_SETTINGS.syncKey;
  const selectors = (document.getElementById("cfg-selectors").value || DEFAULT_SETTINGS.selectors).trim();
  const remoteUrl = (document.getElementById("cfg-remote-url").value || DEFAULT_SETTINGS.remoteUrl).trim();
  const throttleMs = Math.max(0, Number(document.getElementById("cfg-throttle").value || DEFAULT_SETTINGS.throttleMs));
  const browserWindowOffset = Math.max(0, Number(document.getElementById("cfg-window-offset").value || DEFAULT_SETTINGS.browserWindowOffset));
  const errorMarginH = Math.max(0, Number(document.getElementById("cfg-err-h").value || DEFAULT_SETTINGS.errorMarginH));
  const errorMarginV = Math.max(0, Number(document.getElementById("cfg-err-v").value || DEFAULT_SETTINGS.errorMarginV));
  try {
    chrome.storage.sync.set({ theme, syncKey, selectors, remoteUrl, throttleMs, browserWindowOffset, errorMarginH, errorMarginV }, () => {
      applyTheme(theme);
      try { chrome.runtime.sendMessage({ type: "settings_updated", data: { theme, syncKey, selectors, remoteUrl, throttleMs, browserWindowOffset, errorMarginH, errorMarginV } }); } catch (_) {}
      try { chrome.storage.local.set({ reloadNotice: { show: true, at: Date.now() } }); } catch (_) {}
      // Close other detached popups and then fully reload
      closeOtherPopupWindowsThen(() => fullReloadExtensionAndTabs());
    });
  } catch (e) {
    console.error("saveSettings error", e);
  }
}

function resetSettings() {
  try {
    chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
      loadSettings();
      document.getElementById("settings-status").textContent = "Defaults restored.";
      try { chrome.runtime.sendMessage({ type: "settings_updated", data: { ...DEFAULT_SETTINGS } }); } catch (_) {}
      try { chrome.storage.local.set({ reloadNotice: { show: true, at: Date.now() } }); } catch (_) {}
      closeOtherPopupWindowsThen(() => fullReloadExtensionAndTabs());
    });
  } catch (e) {
    console.error("resetSettings error", e);
  }
}

document.getElementById("save-settings").addEventListener("click", saveSettings);
document.getElementById("reset-settings").addEventListener("click", resetSettings);

// Attach event listeners for the log-related buttons.
document.getElementById("export-logs").addEventListener("click", async () => {
  try { const logs = await fetchLogs(); exportLogs(logs); } catch (err) { console.error(err); }
});

// Start live updates
setInterval(tickUpdateIAS, 2000);
setInterval(pollStatus, 2000);
// Initial paint
requestIASummaryAndRender();
pollStatus();
loadSettings();
// Default to Home view on load
try { showView("home"); } catch (_) {}