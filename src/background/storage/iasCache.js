import { parseISO } from "../utils/time.js";

function readMeta(db, callback) {
  const tx = db.transaction("ias_meta", "readonly");
  const store = tx.objectStore("ias_meta");
  const req = store.get("state");
  req.onsuccess = () => {
    const state = req.result || null;
    callback(state);
  };
  req.onerror = (e) => {
    console.error("readMeta error", e.target.error);
    callback(null);
  };
}

function writeMeta(db, state, callback) {
  const tx = db.transaction("ias_meta", "readwrite");
  const store = tx.objectStore("ias_meta");
  const req = store.put(state, "state");
  req.onsuccess = () => {
    if (callback) callback();
  };
  req.onerror = (e) => {
    console.error("writeMeta error", e.target.error);
    if (callback) callback();
  };
}

function appendIASRecords(db, records, callback) {
  if (!records || records.length === 0) {
    if (callback) callback();
    return;
  }
  const tx = db.transaction("ias", "readwrite");
  const store = tx.objectStore("ias");
  let remaining = records.length;
  records.forEach((r) => {
    const req = store.add(r);
    req.onsuccess = () => {
      remaining -= 1;
      if (remaining === 0 && callback) callback();
    };
    req.onerror = (e) => {
      console.error("appendIASRecords error", e.target.error);
      remaining -= 1;
      if (remaining === 0 && callback) callback();
    };
  });
}

function readIASAll(db, callback) {
  const tx = db.transaction("ias", "readonly");
  const store = tx.objectStore("ias");
  const req = store.getAll();
  req.onsuccess = () => {
    callback(req.result || []);
  };
  req.onerror = (e) => {
    console.error("readIASAll error", e.target.error);
    callback([]);
  };
}

function computeIAIncrementalFromLogs(logs, opts) {
  // opts: { baseEpochMs, labelState, nextId, activeRecords, bgConfig }
  const __OFF = Math.max(
    0,
    Number(
      opts.bgConfig && opts.bgConfig.browserWindowOffset != null
        ? opts.bgConfig.browserWindowOffset
        : 91,
    ),
  );
  const __HM = 0; // no horizontal margin for live summary
  const __VM = 0; // no vertical margin for live summary
  const baseEpochMs = Number(opts.baseEpochMs || 0);
  const labelState =
    opts.labelState && typeof opts.labelState === "object" ? opts.labelState : { _counter: 1 };
  let nextId = Number.isFinite(opts.nextId) ? opts.nextId : 1;
  const activeRecords = new Map();

  // restore active records map if provided
  if (opts.activeRecords && Array.isArray(opts.activeRecords)) {
    for (const item of opts.activeRecords) {
      if (item && item.key && item.rec) activeRecords.set(item.key, item.rec);
    }
  }

  function getBaseKeyFromFullKey(fullKey) {
    try {
      return String(fullKey || "").split("::")[0];
    } catch (_) {
      return String(fullKey || "");
    }
  }

  function flushUnusedBaseLabels() {
    // Mirror the offline grouper: once a baseKey is no longer active, forget it so a future reappearance becomes a new root label.
    try {
      const activeBases = new Set(Array.from(activeRecords.keys()).map(getBaseKeyFromFullKey));
      Object.keys(labelState).forEach((base) => {
        if (base === "_counter") return;
        if (!activeBases.has(base)) delete labelState[base];
      });
    } catch (_) {}
  }

  function assignLabel(baseKey, currentPos) {
    let info = labelState[baseKey];
    if (!info) {
      const baseLabel = `autolabel_${labelState._counter || 1}`;
      labelState._counter = (labelState._counter || 1) + 1;
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

  function toRelativeMs(ts) {
    const d = parseISO(ts);
    if (!d) throw new Error(`Invalid log timestamp: ${ts}`);
    return Math.max(0, Math.floor(d.getTime() - baseEpochMs));
  }

  const iaClosed = []; // records closed during this run
  const ordered = [...(logs || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  let lastProcessedIso = null;

  for (const entry of ordered) {
    const isCoordLog = entry && entry.coordinates && Array.isArray(entry.coordinates.coordinates);
    if (!isCoordLog) {
      continue;
    }

    const currentMs = toRelativeMs(entry.timestamp);
    const coordsWrap = (entry.coordinates && entry.coordinates.coordinates) || [];
    const coords = (coordsWrap || []).filter((c) => c && c.width && c.height);
    const seenKeys = new Set();

    if (!coords || coords.length === 0) {
      for (const [key, rec] of Array.from(activeRecords.entries())) {
        rec.end = currentMs;
        iaClosed.push(rec);
        activeRecords.delete(key);
      }
      flushUnusedBaseLabels();
      lastProcessedIso = entry.timestamp;
      continue;
    }

    if (coords.length > 1) {
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

      const label = assignLabel(baseKey, posKey);
      if (!activeRecords.has(fullKey)) {
        const x0 = Math.min(...xs) - __HM;
        const y0 = Math.min(...ys) - __VM;
        const r0 = Math.max(...rights) + __HM;
        const b0 = Math.max(...bottoms) + __VM;
        const rec = {
          start: currentMs,
          end: currentMs,
          id: nextId++,
          label,
          html: mergedHtml,
          x: x0,
          y: y0,
          right: r0,
          bottom: b0,
        };
        activeRecords.set(fullKey, rec);
      } else {
        activeRecords.get(fullKey).end = currentMs;
      }
    } else {
      const c = coords[0];
      const x = c.x;
      const y = c.y + __OFF;
      const mergedHtml = c.html;
      const baseKey = `single|${mergedHtml}|wh|${c.width}x${c.height}`;
      const posKey = `y|${y}`;
      const fullKey = `${baseKey}::${posKey}`;
      seenKeys.add(fullKey);

      const label = assignLabel(baseKey, posKey);
      if (!activeRecords.has(fullKey)) {
        const xAdj = x - __HM;
        const yAdj = y - __VM;
        const rightAdj = x + (c.width || 0) + __HM;
        const bottomAdj = y + (c.height || 0) + __VM;
        const rec = {
          start: currentMs,
          end: currentMs,
          id: nextId++,
          label,
          html: mergedHtml,
          x: xAdj,
          y: yAdj,
          right: rightAdj,
          bottom: bottomAdj,
        };
        activeRecords.set(fullKey, rec);
      } else {
        activeRecords.get(fullKey).end = currentMs;
      }
    }

    for (const [key, rec] of Array.from(activeRecords.entries())) {
      if (!seenKeys.has(key)) {
        iaClosed.push(rec);
        activeRecords.delete(key);
      }
    }
    flushUnusedBaseLabels();

    lastProcessedIso = entry.timestamp;
  }

  // Do not close active records here; keep them for the next incremental run
  return {
    iaClosed,
    labelState,
    nextId,
    activeRecords: Array.from(activeRecords.entries()).map(([key, rec]) => ({ key, rec })),
    lastProcessedIso,
  };
}

function ensureBaseEpochMs(logs, offsetMs) {
  const ordered = [...(logs || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (ordered.length === 0) return null;
  const ipEntry = ordered.find(
    (e) => e && e.coordinates && e.coordinates.message === "First 's' key press logged",
  );
  if (ipEntry) {
    const ipTime = parseISO(ipEntry.coordinates.timestamp);
    if (ipTime) return ipTime.getTime() - Number(offsetMs || 0);
  }
  const firstTs = parseISO(ordered[0].timestamp);
  return firstTs ? firstTs.getTime() : null;
}

export function createIasCache({ getDb, bgConfig }) {
  function updateIasCache(callback) {
    const db = getDb();
    if (!db) {
      callback && callback({ updated: false, error: "db_not_ready" });
      return;
    }

    readMeta(db, (meta) => {
      // Read all logs and compute increment
      const tx = db.transaction("logs", "readonly");
      const store = tx.objectStore("logs");
      const request = store.getAll();
      request.onsuccess = () => {
        const allLogs = request.result || [];
        try {
          const offsetMs = 0;
          let baseEpochMs =
            meta && Number.isFinite(meta.baseEpochMs) ? meta.baseEpochMs : ensureBaseEpochMs(allLogs, offsetMs);
          if (!Number.isFinite(baseEpochMs)) {
            if (!meta) {
              writeMeta(
                db,
                {
                  baseEpochMs: null,
                  lastProcessedIso: null,
                  labelState: { _counter: 1 },
                  nextId: 1,
                  activeRecords: [],
                  lastVisibleRoots: [],
                  lastVisibleAt: null,
                  lastPrimaryRoot: null,
                  lastPrimaryAt: null,
                },
                () => callback && callback({ updated: false }),
              );
            } else {
              callback && callback({ updated: false });
            }
            return;
          }

          const lastIso = meta && meta.lastProcessedIso ? meta.lastProcessedIso : null;
          const labelState = meta && meta.labelState ? meta.labelState : { _counter: 1 };
          const nextId = meta && Number.isFinite(meta.nextId) ? meta.nextId : 1;
          const activeRecords = meta && Array.isArray(meta.activeRecords) ? meta.activeRecords : [];

          const logsSlice = lastIso ? allLogs.filter((l) => new Date(l.timestamp) > new Date(lastIso)) : allLogs;
          if (logsSlice.length === 0) {
            callback && callback({ updated: false });
            return;
          }

          const result = computeIAIncrementalFromLogs(logsSlice, {
            baseEpochMs,
            offsetMs,
            labelState,
            nextId,
            activeRecords,
            bgConfig: bgConfig.get(),
          });

          appendIASRecords(db, result.iaClosed, () => {
            const rootOf = (label) => {
              const m = (label || "").match(/^(autolabel_\d+)/);
              return m ? m[1] : label || "";
            };
            const active = Array.isArray(result.activeRecords)
              ? result.activeRecords.map((x) => x && x.rec).filter(Boolean)
              : [];

            let lastPrimaryRoot =
              meta && typeof meta.lastPrimaryRoot === "string" ? meta.lastPrimaryRoot : null;
            try {
              if (Array.isArray(result.iaClosed) && result.iaClosed.length > 0) {
                const lastClosed = result.iaClosed[result.iaClosed.length - 1];
                if (lastClosed && lastClosed.label) lastPrimaryRoot = rootOf(lastClosed.label);
              } else if (active.length > 0) {
                let best = active[0];
                for (let i = 1; i < active.length; i++) {
                  if ((active[i].end || 0) >= (best.end || 0)) best = active[i];
                }
                if (best && best.label) lastPrimaryRoot = rootOf(best.label);
              }
            } catch (_) {}

            const newMeta = {
              baseEpochMs,
              lastProcessedIso: result.lastProcessedIso || lastIso || null,
              labelState: result.labelState,
              nextId: result.nextId,
              activeRecords: result.activeRecords,
              lastVisibleRoots: Array.from(
                new Set(
                  (result.activeRecords || []).map((x) => {
                    const label = x && x.rec && x.rec.label ? x.rec.label : "";
                    const m = label.match(/^(autolabel_\d+)/);
                    return m ? m[1] : label;
                  }),
                ),
              ),
              lastVisibleAt: result.lastProcessedIso || lastIso || null,
              lastPrimaryRoot: lastPrimaryRoot || null,
              lastPrimaryAt: result.lastProcessedIso || lastIso || null,
              acceptedRoots: Array.isArray(meta && meta.acceptedRoots) ? meta.acceptedRoots.slice() : [],
              recentChecks: Array.isArray(meta && meta.recentChecks) ? meta.recentChecks.slice(-20) : [],
            };

            writeMeta(db, newMeta, () =>
              callback && callback({ updated: true, appended: result.iaClosed.length }),
            );
          });
        } catch (e) {
          console.error("updateIasCache error", e);
          callback && callback({ updated: false, error: String(e) });
        }
      };
      request.onerror = () => {
        callback && callback({ updated: false, error: "logs_read_failed" });
      };
    });
  }

  function getIasSummary(callback) {
    const db = getDb();
    if (!db) {
      callback({ ok: false, error: "db_not_ready" });
      return;
    }

    readMeta(db, (meta) => {
      readIASAll(db, (closed) => {
        try {
          const baseEpochMs = meta && Number.isFinite(meta.baseEpochMs) ? meta.baseEpochMs : null;
          const lastIso = meta && meta.lastProcessedIso ? meta.lastProcessedIso : null;
          const active = meta && Array.isArray(meta.activeRecords) ? meta.activeRecords.map((x) => x.rec) : [];

          let nowMs = 0;
          if (baseEpochMs && lastIso) {
            const d = parseISO(lastIso);
            if (d) nowMs = Math.max(0, Math.floor(d.getTime() - baseEpochMs));
          }

          const activeSummaries = active.map((r) => ({
            label: r.label,
            start: r.start,
            end: nowMs,
            x: r.x,
            y: r.y,
            width: typeof r.right === "number" && typeof r.x === "number" ? r.right - r.x : undefined,
            height:
              typeof r.bottom === "number" && typeof r.y === "number" ? r.bottom - r.y : undefined,
            html: r.html,
            isActive: true,
          }));
          const closedSummaries = (closed || []).map((r) => ({
            label: r.label,
            start: r.start,
            end: r.end,
            x: r.x,
            y: r.y,
            width: typeof r.right === "number" && typeof r.x === "number" ? r.right - r.x : undefined,
            height:
              typeof r.bottom === "number" && typeof r.y === "number" ? r.bottom - r.y : undefined,
            html: r.html,
            isActive: false,
          }));

          const all = closedSummaries.concat(activeSummaries);
          all.sort((a, b) => a.start - b.start);

          const rootOf = (label) => {
            const m = (label || "").match(/^(autolabel_\d+)/);
            return m ? m[1] : label || "";
          };

          // IMPORTANT: do NOT infer acceptance from recent checks
          const acceptedRootsPersisted = Array.isArray(meta && meta.acceptedRoots)
            ? new Set(meta.acceptedRoots)
            : new Set();
          for (const r of all) {
            const isAccepted = acceptedRootsPersisted.has(rootOf(r.label));
            r.accepted = r.isActive ? null : isAccepted;
          }

          let trimmed = all.slice(-200);
          try {
            const presentRoots = new Set(trimmed.map((r) => rootOf(r.label)));
            if (presentRoots.size > 0) {
              const earliestByRoot = new Map();
              for (const r of all) {
                const rt = rootOf(r.label);
                if (!earliestByRoot.has(rt)) earliestByRoot.set(rt, r);
              }
              const existingKeys = new Set(trimmed.map((r) => `${r.label}|${r.start}|${r.end}`));
              for (const rt of presentRoots) {
                const first = earliestByRoot.get(rt);
                if (first) {
                  const key = `${first.label}|${first.start}|${first.end}`;
                  if (!existingKeys.has(key)) trimmed.push(first);
                }
              }
              trimmed.sort((a, b) => a.start - b.start);
            }
          } catch (_) {}

          callback({ ok: true, records: trimmed });
        } catch (e) {
          console.error("getIasSummary error", e);
          callback({ ok: false, error: String(e) });
        }
      });
    });
  }

  function markAcceptanceAgainstPrimaryRoot(callback) {
    const db = getDb();
    if (!db) {
      callback && callback({ ok: false, error: "db_not_ready" });
      return;
    }

    // IMPORTANT: run updateIasCache first
    updateIasCache(() => {
      readMeta(db, (meta) => {
        try {
          const acceptedRoots = Array.isArray(meta && meta.acceptedRoots) ? meta.acceptedRoots.slice() : [];
          const root = meta && typeof meta.lastPrimaryRoot === "string" ? meta.lastPrimaryRoot : null;
          if (root && !acceptedRoots.includes(root)) acceptedRoots.push(root);
          const newMeta = {
            baseEpochMs: meta ? meta.baseEpochMs : null,
            lastProcessedIso: meta ? meta.lastProcessedIso : null,
            labelState: meta ? meta.labelState : { _counter: 1 },
            nextId: meta ? meta.nextId : 1,
            activeRecords: meta ? meta.activeRecords : [],
            lastVisibleRoots: meta && Array.isArray(meta.lastVisibleRoots) ? meta.lastVisibleRoots : [],
            lastVisibleAt: meta ? meta.lastVisibleAt : null,
            lastPrimaryRoot: meta ? meta.lastPrimaryRoot : null,
            lastPrimaryAt: meta ? meta.lastPrimaryAt : null,
            acceptedRoots,
            recentChecks: Array.isArray(meta && meta.recentChecks) ? meta.recentChecks.slice(-20) : [],
          };
          writeMeta(db, newMeta, () => {
            try {
              console.log("[MatchingCheck]", { reason: "acceptedRoots-update", root });
            } catch (_) {}
            callback && callback({ ok: true, root });
          });
        } catch (e) {
          console.error("acceptedRoots update error", e);
          callback && callback({ ok: false, error: String(e) });
        }
      });
    });
  }

  function appendAcceptanceCheck(data, callback) {
    const db = getDb();
    if (!db) {
      callback && callback({ ok: false, error: "db_not_ready" });
      return;
    }
    readMeta(db, (meta) => {
      try {
        const recentChecks = Array.isArray(meta && meta.recentChecks) ? meta.recentChecks.slice(-40) : [];
        recentChecks.push({ ...(data || {}) });
        const newMeta = { ...(meta || {}), recentChecks };
        writeMeta(db, newMeta, () => {
          try {
            console.log("[MatchingCheck]", { reason: "check-added", ok: data && data.ok, top: data && data.top });
          } catch (_) {}
          callback && callback({ ok: true });
        });
      } catch (e) {
        console.error("recentChecks update error", e);
        callback && callback({ ok: false, error: String(e) });
      }
    });
  }

  function getStatus(callback) {
    const db = getDb();
    const result = { dbConnected: !!db, lastLogAgeMs: null, lastProcessedIso: null };
    if (!db) {
      callback(result);
      return;
    }

    try {
      readMeta(db, (meta) => {
        if (meta && meta.lastProcessedIso) result.lastProcessedIso = meta.lastProcessedIso;

        try {
          const tx = db.transaction("logs", "readonly");
          const store = tx.objectStore("logs");
          const req = store.openCursor(null, "prev");
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor && cursor.value && cursor.value.timestamp) {
              const d = parseISO(cursor.value.timestamp);
              if (d) result.lastLogAgeMs = Date.now() - d.getTime();
            }
            callback(result);
          };
          req.onerror = () => callback(result);
        } catch (e) {
          console.error("getLastLogTimestamp error", e);
          callback(result);
        }
      });
    } catch (e) {
      console.error("getStatus error", e);
      callback(result);
    }
  }

  return {
    updateIasCache,
    getIasSummary,
    markAcceptanceAgainstPrimaryRoot,
    appendAcceptanceCheck,
    getStatus,
  };
}


