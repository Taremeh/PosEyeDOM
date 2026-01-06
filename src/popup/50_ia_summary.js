// Live IA summary rendering (groups + preview).
(function installIASummary() {
  const NS = globalThis.__POSEYEDOM.popup;

  const expandState = new Set(); // root labels expanded in UI

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
      if (typeof r.start === "number" && r.start < g.start) g.start = r.start;
      if (typeof r.end === "number" && r.end > g.end) g.end = r.end;
    }
    const arr = Array.from(groups.values());
    arr.sort((a, b) => a.start - b.start);
    arr.forEach((g) => g.children.sort((a, b) => a.start - b.start));
    return arr;
  }

  function msToSeconds(ms) {
    const v = Math.max(0, Number(ms || 0)) / 1000;
    if (v > 0 && v < 0.01) return "&lt;0.01";
    return v.toFixed(2);
  }

  function renderIASummary(records) {
    const tbody = document.getElementById("ia-tbody");
    const title = document.getElementById("ia-summary-title");
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    const groups = groupByRoot(records);

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
      const groupLive = g.children.some((c) => c && c.isActive === true);

      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => {
        if (expandState.has(rootId)) expandState.delete(rootId);
        else expandState.add(rootId);
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
      if (groupLive) {
        tdDur.innerHTML = `<span class="pill mono live-chip">${msToSeconds(durationMs)}s</span>`;
      } else {
        const groupAccepted = g.children.some((c) => c && c.accepted === true);
        const chipColor = groupAccepted ? "rgba(45,164,78,0.15)" : "rgba(207,34,46,0.15)";
        const chipBorder = groupAccepted ? "rgba(45,164,78,0.35)" : "rgba(207,34,46,0.45)";
        const chipText = groupAccepted ? "#91d1a7" : "#ffb1b8";
        tdDur.innerHTML = `<span class="chip mono" style="background:${chipColor};border-color:${chipBorder};color:${chipText}">${msToSeconds(durationMs)}s</span>`;
      }
      tr.appendChild(tdDur);
      tbody.appendChild(tr);

      if (!isExpanded) return;

      const occurrences = g.children;
      const child = occurrences[0];

      const ctr = document.createElement("tr");
      const rowCell = document.createElement("td");
      rowCell.colSpan = 3;
      rowCell.style.padding = "6px 0";

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
      try {
        content.innerHTML = child.html || "";
      } catch (_) {
        content.textContent = child.html || "";
      }

      const hsvgHolder = document.createElement("div");
      hsvgHolder.className = "hsvg-holder";
      hsvgHolder.style.width = "auto";

      box.appendChild(content);
      box.appendChild(hsvgHolder);

      const previewLabel = document.createElement("div");
      previewLabel.className = "small muted";
      previewLabel.style.margin = "8px 0 6px";
      previewLabel.style.width = "100%";
      previewLabel.style.fontWeight = "600";
      previewLabel.style.fontSize = "12px";
      previewLabel.textContent = "Suggestion Preview";

      const vsvgHolder = document.createElement("div");
      vsvgHolder.style.position = "relative";
      vsvgHolder.style.width = "48px";
      vsvgHolder.style.height = "0px";
      leftCol.appendChild(vsvgHolder);

      requestAnimationFrame(() => {
        try {
          const labelRect = previewLabel && previewLabel.getBoundingClientRect ? previewLabel.getBoundingClientRect() : null;
          const labelHeight = labelRect ? labelRect.height : 0;
          const labelMarginTop = 8,
            labelMarginBottom = 6;
          vsvgHolder.style.marginTop = `${labelHeight + labelMarginTop + labelMarginBottom}px`;

          const w = Math.max(0, content.clientWidth || 0);
          const h = Math.max(0, content.clientHeight || 0);

          // Horizontal ruler
          hsvgHolder.innerHTML = "";
          const hsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          hsvg.setAttribute("width", String(w));
          hsvg.setAttribute("height", "22");
          const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          hLine.setAttribute("x1", "0");
          hLine.setAttribute("y1", "10");
          hLine.setAttribute("x2", String(w));
          hLine.setAttribute("y2", "10");
          hLine.setAttribute("stroke", "#6e7681");
          hLine.setAttribute("stroke-width", "1");
          const hLeft = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hLeft.setAttribute("d", "M6 6 L0 10 L6 14");
          hLeft.setAttribute("stroke", "#6e7681");
          hLeft.setAttribute("fill", "none");
          const hRight = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hRight.setAttribute("d", `M${w - 6} 6 L${w} 10 L${w - 6} 14`);
          hRight.setAttribute("stroke", "#6e7681");
          hRight.setAttribute("fill", "none");
          const hText = document.createElementNS("http://www.w3.org/2000/svg", "text");
          hText.setAttribute("x", String(Math.max(0, w / 2)));
          hText.setAttribute("y", "21");
          hText.setAttribute("text-anchor", "middle");
          hText.setAttribute("font-size", "11");
          hText.setAttribute("fill", "#8b949e");
          hText.textContent = `${typeof child.width === "number" ? child.width.toFixed(2) : String(w)} px`;
          hsvg.appendChild(hLine);
          hsvg.appendChild(hLeft);
          hsvg.appendChild(hRight);
          hsvg.appendChild(hText);
          hsvgHolder.appendChild(hsvg);

          // Vertical ruler
          vsvgHolder.innerHTML = "";
          const vsvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          vsvg.setAttribute("width", "48");
          vsvg.setAttribute("height", String(h));
          const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          vLine.setAttribute("x1", "46");
          vLine.setAttribute("y1", "0");
          vLine.setAttribute("x2", "46");
          vLine.setAttribute("y2", String(h));
          vLine.setAttribute("stroke", "#6e7681");
          vLine.setAttribute("stroke-width", "1");
          const vTop = document.createElementNS("http://www.w3.org/2000/svg", "path");
          vTop.setAttribute("d", "M44 6 L46 0 L48 6");
          vTop.setAttribute("stroke", "#6e7681");
          vTop.setAttribute("fill", "none");
          const vBot = document.createElementNS("http://www.w3.org/2000/svg", "path");
          vBot.setAttribute("d", `M44 ${h - 6} L46 ${h} L48 ${h - 6}`);
          vBot.setAttribute("stroke", "#6e7681");
          vBot.setAttribute("fill", "none");
          const vText = document.createElementNS("http://www.w3.org/2000/svg", "text");
          vText.setAttribute("x", "42");
          vText.setAttribute("y", String(Math.max(12, h / 2 - 4)));
          vText.setAttribute("text-anchor", "end");
          vText.setAttribute("font-size", "11");
          vText.setAttribute("fill", "#8b949e");
          vText.textContent = `${typeof child.height === "number" ? child.height.toFixed(2) : String(h)}`;
          const vText2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
          vText2.setAttribute("x", "42");
          vText2.setAttribute("y", String(Math.max(24, h / 2 + 8)));
          vText2.setAttribute("text-anchor", "end");
          vText2.setAttribute("font-size", "11");
          vText2.setAttribute("fill", "#8b949e");
          vText2.textContent = "px";
          vsvg.appendChild(vLine);
          vsvg.appendChild(vTop);
          vsvg.appendChild(vBot);
          vsvg.appendChild(vText);
          vsvg.appendChild(vText2);
          vsvgHolder.appendChild(vsvg);
        } catch (e) {
          console.error("Failed to render measurement", e);
        }
      });

      rightCol.appendChild(previewLabel);
      rightCol.appendChild(box);
      rowWrap.appendChild(leftCol);
      rowWrap.appendChild(rightCol);
      rowCell.appendChild(rowWrap);
      ctr.appendChild(rowCell);
      tbody.appendChild(ctr);

      // Meta row
      const metaRow = document.createElement("tr");
      const metaCell = document.createElement("td");
      metaCell.colSpan = 3;
      metaCell.style.padding = "8px 0 24px 0";
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
      const row1c1 = document.createElement("td");
      row1c1.className = "small muted";
      row1c1.style.padding = "0 6px 2px 0";
      row1c1.textContent = "⌖";
      const row1c2 = document.createElement("td");
      row1c2.className = "small muted mono";
      row1c2.style.padding = "0 0 2px 0";
      const xyVal = typeof child.x === "number" && typeof child.y === "number" ? `${child.x.toFixed(2)}, ${child.y.toFixed(2)}` : "";
      row1c2.textContent = `x,y ${xyVal} px`;
      row1.appendChild(row1c1);
      row1.appendChild(row1c2);
      const row2 = document.createElement("tr");
      const row2c1 = document.createElement("td");
      row2c1.className = "small muted";
      row2c1.style.padding = "0 6px 0 0";
      row2c1.textContent = "⏱";
      const row2c2 = document.createElement("td");
      row2c2.className = "small muted mono";
      row2c2.style.padding = "0";
      const aggStart = occurrences[0].start;
      const aggEnd = occurrences[occurrences.length - 1].end;
      row2c2.textContent = `${aggStart} → ${aggEnd} ms`;
      row2.appendChild(row2c1);
      row2.appendChild(row2c2);
      const row3 = document.createElement("tr");
      const row3c1 = document.createElement("td");
      row3c1.className = "small muted";
      row3c1.style.padding = "0 6px 0 0";
      row3c1.textContent = "Accepted";
      const row3c2 = document.createElement("td");
      row3c2.className = "small muted mono";
      row3c2.style.padding = "0";
      const liveChild = g.children.some((c) => c && c.isActive === true);
      if (liveChild) row3c2.textContent = "LIVE (pending)";
      else row3c2.textContent = g.children.some((c) => c && c.accepted === true) ? "true" : "false";
      row3.appendChild(row3c1);
      row3.appendChild(row3c2);
      metaTable.appendChild(row1);
      metaTable.appendChild(row2);
      metaTable.appendChild(row3);
      metaContainer.appendChild(metaLabel);
      metaContainer.appendChild(metaTable);
      metaCell.appendChild(metaContainer);
      metaRow.appendChild(metaCell);
      tbody.appendChild(metaRow);

      // Positional changes chart (only if multiple occurrences)
      if (occurrences.length > 1) {
        const xs = occurrences.map((o) => (typeof o.x === "number" ? o.x : 0));
        const ys = occurrences.map((o) => (typeof o.y === "number" ? o.y : 0));
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
        const titleEl = document.createElement("div");
        titleEl.className = "small muted";
        titleEl.style.margin = "8px 0 6px";
        titleEl.style.marginLeft = `${LEFT_OFFSET}px`;
        titleEl.style.fontWeight = "600";
        titleEl.style.fontSize = "12px";
        titleEl.textContent = `Positional Changes (${n})`;
        chartContainer.appendChild(titleEl);

        const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const H = 160;
        const ML = 40,
          MR = 12,
          MT = 10,
          MB = 52;
        chart.setAttribute("height", String(H));
        chart.style.display = "block";

        function renderChart() {
          const availW =
            chartContainer.clientWidth ||
            (chartContainer.getBoundingClientRect ? chartContainer.getBoundingClientRect().width : 320) ||
            320;
          const W = Math.max(LEFT_OFFSET + 280, availW);
          chart.setAttribute("width", String(W));
          chart.setAttribute("viewBox", `0 0 ${W} ${H}`);

          // Clear previous contents
          while (chart.firstChild) chart.removeChild(chart.firstChild);

          const plotW = W - ML - MR;
          const plotH = H - MT - MB;

          const minXVal = Math.min(...xs),
            maxXVal = Math.max(...xs);
          const minYVal = Math.min(...ys),
            maxYVal = Math.max(...ys);
          const minVal = Math.min(minXVal, minYVal),
            maxVal = Math.max(maxXVal, maxYVal);
          const d = maxVal - minVal || 1;

          const xPos = (i) => ML + (n === 1 ? plotW / 2 : i * (plotW / (n - 1)));
          const yPos = (v) => MT + plotH - ((v - minVal) / d) * plotH;

          // Axes
          const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "path");
          xAxis.setAttribute("d", `M${ML} ${MT + plotH} L${ML + plotW} ${MT + plotH}`);
          xAxis.setAttribute("stroke", "#30363d");
          xAxis.setAttribute("stroke-width", "1");
          chart.appendChild(xAxis);

          const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "path");
          yAxis.setAttribute("d", `M${ML} ${MT} L${ML} ${MT + plotH}`);
          yAxis.setAttribute("stroke", "#30363d");
          yAxis.setAttribute("stroke-width", "1");
          chart.appendChild(yAxis);

          // Y ticks (5)
          for (let i = 0; i <= 4; i++) {
            const val = minVal + (d * i) / 4;
            const y = yPos(val);
            const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
            tick.setAttribute("x1", String(ML - 4));
            tick.setAttribute("y1", String(y));
            tick.setAttribute("x2", String(ML));
            tick.setAttribute("y2", String(y));
            tick.setAttribute("stroke", "#30363d");
            chart.appendChild(tick);

            const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
            lbl.setAttribute("x", String(ML - 6));
            lbl.setAttribute("y", String(y + 4));
            lbl.setAttribute("text-anchor", "end");
            lbl.setAttribute("font-size", "10");
            lbl.setAttribute("fill", "#8b949e");
            lbl.textContent = Math.round(val).toString();
            chart.appendChild(lbl);
          }

          // X enumeration ticks (1..N)
          for (let i = 0; i < n; i++) {
            const x = xPos(i);
            const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
            tick.setAttribute("x1", String(x));
            tick.setAttribute("y1", String(MT + plotH));
            tick.setAttribute("x2", String(x));
            tick.setAttribute("y2", String(MT + plotH + 4));
            tick.setAttribute("stroke", "#30363d");
            chart.appendChild(tick);

            const num = document.createElementNS("http://www.w3.org/2000/svg", "text");
            num.setAttribute("x", String(x));
            num.setAttribute("y", String(MT + plotH + 16));
            num.setAttribute("text-anchor", "middle");
            num.setAttribute("font-size", "10");
            num.setAttribute("fill", "#8b949e");
            num.textContent = String(i + 1);
            chart.appendChild(num);
          }

          // X and Y lines + points
          let dX = "";
          xs.forEach((v, i) => {
            const x = xPos(i),
              y = yPos(v);
            dX += (i ? " L" : "M") + x + " " + y;
          });
          const pathX = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathX.setAttribute("d", dX);
          pathX.setAttribute("fill", "none");
          pathX.setAttribute("stroke", "#2da44e");
          pathX.setAttribute("stroke-width", "2");
          chart.appendChild(pathX);

          let dY = "";
          ys.forEach((v, i) => {
            const x = xPos(i),
              y = yPos(v);
            dY += (i ? " L" : "M") + x + " " + y;
          });
          const pathY = document.createElementNS("http://www.w3.org/2000/svg", "path");
          pathY.setAttribute("d", dY);
          pathY.setAttribute("fill", "none");
          pathY.setAttribute("stroke", "#58a6ff");
          pathY.setAttribute("stroke-width", "2");
          chart.appendChild(pathY);

          xs.forEach((v, i) => {
            const cx = xPos(i),
              cy = yPos(v);
            const pt = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            pt.setAttribute("cx", String(cx));
            pt.setAttribute("cy", String(cy));
            pt.setAttribute("r", "2.5");
            pt.setAttribute("fill", "#2da44e");
            chart.appendChild(pt);
          });

          ys.forEach((v, i) => {
            const cx = xPos(i),
              cy = yPos(v);
            const pt = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            pt.setAttribute("cx", String(cx));
            pt.setAttribute("cy", String(cy));
            pt.setAttribute("r", "2.5");
            pt.setAttribute("fill", "#58a6ff");
            chart.appendChild(pt);
          });
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

        const legX = document.createElement("div");
        legX.style.display = "flex";
        legX.style.alignItems = "center";
        legX.style.gap = "6px";
        const legXLine = document.createElement("span");
        legXLine.style.display = "inline-block";
        legXLine.style.width = "14px";
        legXLine.style.height = "2px";
        legXLine.style.background = "#2da44e";
        const legXText = document.createElement("span");
        legXText.className = "mono";
        legXText.textContent = "x";
        legX.appendChild(legXLine);
        legX.appendChild(legXText);

        const legY = document.createElement("div");
        legY.style.display = "flex";
        legY.style.alignItems = "center";
        legY.style.gap = "6px";
        const legYLine = document.createElement("span");
        legYLine.style.display = "inline-block";
        legYLine.style.width = "14px";
        legYLine.style.height = "2px";
        legYLine.style.background = "#58a6ff";
        const legYText = document.createElement("span");
        legYText.className = "mono";
        legYText.textContent = "y";
        legY.appendChild(legYLine);
        legY.appendChild(legYText);

        legend.appendChild(legX);
        legend.appendChild(legY);
        chartContainer.appendChild(legend);

        chartCell.appendChild(chartContainer);
        chartRow.appendChild(chartCell);
        tbody.appendChild(chartRow);

        // Render after insertion for correct width
        requestAnimationFrame(renderChart);

        // Keep chart responsive (especially in detached window)
        try {
          if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
              try {
                renderChart();
              } catch (_) {}
            });
            ro.observe(chartContainer);
          } else {
            window.addEventListener("resize", () => {
              try {
                renderChart();
              } catch (_) {}
            });
          }
        } catch (_) {}
      }
    });
  }

  function requestIASummaryAndRender() {
    try {
      chrome.runtime.sendMessage({ type: "get_ia_summary" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("get_ia_summary error:", chrome.runtime.lastError.message);
          return;
        }
        if (!response || !response.ok) return;
        renderIASummary(response.records || []);
      });
    } catch (e) {
      console.error("requestIASummaryAndRender error", e);
    }
  }

  function tickUpdateIAS() {
    try {
      chrome.runtime.sendMessage({ type: "force_update_ias" }, () => {
        if (chrome.runtime.lastError) console.error("force_update_ias error:", chrome.runtime.lastError.message);
        requestIASummaryAndRender();
      });
    } catch (e) {
      console.error("tickUpdateIAS error", e);
    }
  }

  NS.api.renderIASummary = renderIASummary;
  NS.api.requestIASummaryAndRender = requestIASummaryAndRender;
  NS.api.tickUpdateIAS = tickUpdateIAS;
})();


