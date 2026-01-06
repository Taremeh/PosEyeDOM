// IA/HTML computation + request/response bridge for the popup.
(function installIAComputer() {
  const NS = globalThis.__POSEYEDOM.content;

  function getWindowOffset() {
    try {
      const cfg = NS.state && NS.state.config ? NS.state.config : null;
      if (cfg && cfg.browserWindowOffset != null) return Math.max(0, Number(cfg.browserWindowOffset));
    } catch (_) {}
    return 91;
  }

  function parseISO(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function assignLabel(baseKey, currentPos, labelState) {
    let info = labelState[baseKey];
    if (!info) {
      const baseLabel = `autolabel_${labelState._counter}`;
      labelState._counter += 1;
      info = { baseLabel, lastPos: null, nextSuffix: 1 };
      labelState[baseKey] = info;
    }
    let label;
    if (info.lastPos === currentPos) {
      label = info.baseLabel;
    } else {
      if (info.lastPos === null) {
        label = info.baseLabel;
      } else {
        label = `${info.baseLabel}_${info.nextSuffix}`;
        info.nextSuffix += 1;
      }
      info.lastPos = currentPos;
    }
    return label;
  }

  function flushUnusedBaseLabels(activeRecords, labelState) {
    const activeBases = new Set(Array.from(activeRecords.keys()).map((k) => k.split("::")[0]));
    Object.keys(labelState).forEach((base) => {
      if (base === "_counter") return;
      if (!activeBases.has(base)) delete labelState[base];
    });
  }

  function computeIAFromLogs(logs, opts = {}) {
    const cfg = NS.state && NS.state.config ? NS.state.config : {};
    const offsetMsInput = Number(opts.offsetMs || 0);
    const windowOffset = Number.isFinite(opts.browserWindowOffset)
      ? Math.max(0, Number(opts.browserWindowOffset))
      : getWindowOffset();

    const ordered = [...(logs || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (ordered.length === 0) {
      return { iasText: "# IA\tstart_time\tend_time\tshape\tID\tx\ty\tright\tbottom\tlabel\n", htmlMapping: {} };
    }

    const ipEntry = ordered.find((e) => e && e.coordinates && e.coordinates.message === "First 's' key press logged");

    let baseEpochMs;
    if (ipEntry) {
      const ipTime = parseISO(ipEntry.coordinates.timestamp);
      if (!ipTime) {
        const firstTs = parseISO(ordered[0].timestamp);
        if (!firstTs) throw new Error("No valid timestamps in logs.");
        baseEpochMs = firstTs.getTime();
      } else {
        baseEpochMs = ipTime.getTime() - offsetMsInput;
      }
    } else {
      const firstTs = parseISO(ordered[0].timestamp);
      if (!firstTs) throw new Error("No valid timestamps in logs.");
      baseEpochMs = firstTs.getTime();
    }

    const toRelativeMs = (ts) => {
      const d = parseISO(ts);
      if (!d) throw new Error(`Invalid log timestamp: ${ts}`);
      return Math.max(0, Math.floor(d.getTime() - baseEpochMs));
    };

    const activeRecords = new Map(); // key -> rec
    const labelState = { _counter: 1 };
    const iaData = [];
    const htmlMapping = {};
    let nextId = 1;
    let lastCoordIso = null;

    for (const entry of ordered) {
      const isCoordLog = entry && entry.coordinates && Array.isArray(entry.coordinates.coordinates);
      if (!isCoordLog) continue;

      const currentMs = toRelativeMs(entry.timestamp);
      const coordsWrap = entry.coordinates.coordinates || [];
      const coords = coordsWrap.filter((c) => c && c.width && c.height);
      const seenKeys = new Set();

      if (!coords || coords.length === 0) {
        for (const [key, rec] of Array.from(activeRecords.entries())) {
          rec.end = currentMs;
          iaData.push(rec);
          activeRecords.delete(key);
        }
        flushUnusedBaseLabels(activeRecords, labelState);
        lastCoordIso = entry.timestamp;
        continue;
      }

      if (coords.length > 1) {
        const __OFF = windowOffset;
        const sorted = [...coords].sort((a, b) => a.y + __OFF - (b.y + __OFF));
        let mergedHtml = "";
        const ys = [],
          xs = [],
          rights = [],
          bottoms = [];
        let lastY = null;
        for (const c of sorted) {
          const x = c.x;
          const y = c.y + __OFF;
          if (lastY !== null && y > lastY) mergedHtml += "\n";
          mergedHtml += c.html;
          lastY = y;
          ys.push(y);
          xs.push(x);
          rights.push(x + (c.width || 0));
          bottoms.push(y + (c.height || 0));
        }
        const baseKey = `multi|${mergedHtml}`;
        const posKey = `ys|${ys.join(",")}`;
        const fullKey = `${baseKey}::${posKey}`;
        seenKeys.add(fullKey);

        const label = assignLabel(baseKey, posKey, labelState);
        if (!activeRecords.has(fullKey)) {
          const hM = Number.isFinite(opts.errorMarginH)
            ? Math.max(0, Number(opts.errorMarginH))
            : Math.max(0, Number(cfg.errorMarginH != null ? cfg.errorMarginH : 0));
          const vM = Number.isFinite(opts.errorMarginV)
            ? Math.max(0, Number(opts.errorMarginV))
            : Math.max(0, Number(cfg.errorMarginV != null ? cfg.errorMarginV : 0));
          const x0 = Math.min(...xs) - hM;
          const y0 = Math.min(...ys) - vM;
          const r0 = Math.max(...rights) + hM;
          const b0 = Math.max(...bottoms) + vM;
          const rec = { start: currentMs, end: currentMs, id: nextId++, label, html: mergedHtml, x: x0, y: y0, right: r0, bottom: b0 };
          activeRecords.set(fullKey, rec);
          htmlMapping[label] = mergedHtml;
        } else {
          activeRecords.get(fullKey).end = currentMs;
        }
      } else {
        const c = coords[0];
        const x = c.x;
        const y = c.y + windowOffset;
        const mergedHtml = c.html;
        const baseKey = `single|${mergedHtml}|wh|${c.width}x${c.height}`;
        const posKey = `y|${y}`;
        const fullKey = `${baseKey}::${posKey}`;
        seenKeys.add(fullKey);

        const label = assignLabel(baseKey, posKey, labelState);
        if (!activeRecords.has(fullKey)) {
          const hM = Number.isFinite(opts.errorMarginH)
            ? Math.max(0, Number(opts.errorMarginH))
            : Math.max(0, Number(cfg.errorMarginH != null ? cfg.errorMarginH : 0));
          const vM = Number.isFinite(opts.errorMarginV)
            ? Math.max(0, Number(opts.errorMarginV))
            : Math.max(0, Number(cfg.errorMarginV != null ? cfg.errorMarginV : 0));
          const xAdj = x - hM;
          const yAdj = y - vM;
          const rightAdj = x + (c.width || 0) + hM;
          const bottomAdj = y + (c.height || 0) + vM;
          const rec = { start: currentMs, end: currentMs, id: nextId++, label, html: mergedHtml, x: xAdj, y: yAdj, right: rightAdj, bottom: bottomAdj };
          activeRecords.set(fullKey, rec);
          htmlMapping[label] = mergedHtml;
        } else {
          activeRecords.get(fullKey).end = currentMs;
        }
      }

      for (const [key, rec] of Array.from(activeRecords.entries())) {
        if (!seenKeys.has(key)) {
          rec.end = currentMs;
          iaData.push(rec);
          activeRecords.delete(key);
        }
      }
      flushUnusedBaseLabels(activeRecords, labelState);
      lastCoordIso = entry.timestamp;
    }

    const finalMs = lastCoordIso ? toRelativeMs(lastCoordIso) : 0;
    for (const rec of activeRecords.values()) {
      rec.end = finalMs;
      iaData.push(rec);
    }

    let iasText = "# IA\tstart_time\tend_time\tshape\tID\tx\ty\tright\tbottom\tlabel\n";
    for (const rec of iaData) {
      iasText += `-${rec.start}\t-${rec.end}\tRECTANGLE\t${rec.id}\t${rec.x.toFixed(2)}\t${rec.y.toFixed(2)}\t${rec.right.toFixed(2)}\t${rec.bottom.toFixed(2)}\t${rec.label}\n`;
    }

    return { iasText, htmlMapping };
  }

  NS.iaComputer = { computeIAFromLogs };

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "compute_ia_html_from_logs") {
        try {
          const { logs, offsetMs, errorMarginH, errorMarginV, browserWindowOffset } = message;
          const out = computeIAFromLogs(Array.isArray(logs) ? logs : [], { offsetMs, errorMarginH, errorMarginV, browserWindowOffset });
          sendResponse({ ok: true, ...out });
        } catch (e) {
          sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
        }
        return true;
      }
    });
  } catch (err) {
    console.error("Failed to attach compute_ia_html_from_logs listener:", err);
  }
})();


