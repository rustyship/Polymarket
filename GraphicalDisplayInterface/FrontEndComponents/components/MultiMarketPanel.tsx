// MultiMarketPanel.tsx
import React, { useCallback, useMemo, useState, useEffect } from "react";
import MarketPricesPanel from "./MarketPricesPanel";
import ComparePanel from "./ComparePanel";
import ChartsHost from "./ChartHost";
import "./charts.css"
/** Backend pair used across the app. */
export type NameIdPair = {
  marketName: string;
  marketID: string;
};

/** Request shape each row should ultimately produce. */
export type BaseParams = {
  // base params now take a name-id pair (not a plain string)
  nameID: NameIdPair;
  start: Date | null;
  end: Date | null;
  fidelity: number; // minutes
};

/** Row model for this UI. initial is optional until the child populates it. */
type Row = {
  id: string;
  initial?: BaseParams;
};

type MultiMarketPanelProps = {
  apiBase?: string;
  /** Optional: called whenever the collected BaseParams[] changes */
  onResultsChange?: (sources: BaseParams[]) => void;
  /** Optional: how many empty rows to start with */
  initialRows?: number;
};

function mkId() {
  // short enough for UI keys, unique enough for this panel’s lifetime
  return Math.random().toString(36).slice(2, 9);
}

const Font = "14px"
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function MultiMarketPanel({
  apiBase = API_BASE,
  onResultsChange,
  initialRows = 1,
}: MultiMarketPanelProps) {
  // Visual rows to render
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: Math.max(1, initialRows) }, () => ({ id: mkId() }))
  );

  // Collected BaseParams by row id
  const [byId, setById] = useState<Record<string, BaseParams>>({});

  // Button UX state only. Does not mutate ComparePanel.
  const [busy, setBusy] = useState(false);

  // Safely collect only rows that have completed BaseParams
  const results = useMemo(
    () => rows.map(r => byId[r.id]).filter((x): x is BaseParams => !!x),
    [rows, byId]
  );

  // Bubble results up if needed
  useEffect(() => {
    onResultsChange?.(results);
  }, [results, onResultsChange]);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, { id: mkId() }]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
    // also drop any collected BaseParams for that row id
    setById(prev => {
      if (!(id in prev)) return prev;
      const { [id]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleFetched = useCallback((id: string, resp: BaseParams) => {
    setById((prev) => ({ ...prev, [id]: resp }));
  }, []);

  const duplicateRow = useCallback((id: string) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx === -1) return prev;

      // Prefer the latest collected BaseParams for that row; otherwise reuse its initial.
      const existing: BaseParams | undefined = byId[id] ?? prev[idx].initial;
      const init: BaseParams | undefined = existing ? { ...existing } : undefined;

      return [...prev, { id: mkId(), initial: init }];
    });
  }, [byId]);

  const onRowChange = useCallback((id: string, next?: BaseParams) => {
    setById(prev => {
      // If the child cleared its data (e.g. reset), remove from map
      if (!next) {
        if (!(id in prev)) return prev;
        const { [id]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }, []);

  // Keeps the button UI; ComparePanel does its own thing with `sources`.
  const runCompare = useCallback(() => {
    if (results.length < 2 || busy) return;
    setBusy(true);
    // Simulate a very short pulse so the user gets feedback; ComparePanel
    // runs on prop change, not this toggle.
    setTimeout(() => setBusy(false), 200);
  }, [results.length, busy]);

  const [namesIds, setNames] = useState<NameIdPair[]>();
  useEffect(() => {
    let ac = new AbortController();
    fetch(`${apiBase}/markets/names`, { signal: ac.signal })
      .then(r => r.json())
      .then(setNames)
      .catch(()=>{});
    return () => ac.abort();
  }, [apiBase]);

  const ROW_WIDTH = 860;  // left panel (MarketPricesPanel) width
  const CTRL_WIDTH = 220;  // right controls column width
  const GAP = 2;   // space between columns
  const TOTAL_WIDTH = ROW_WIDTH + CTRL_WIDTH + GAP +20;

  return (
    <div style={{ padding: 8 }}>
      {/* Rows container has a hard total width */}
      <div
        style={{
          width: TOTAL_WIDTH,
          display: "grid",
          gridTemplateColumns: "1fr", // each row is its own line
          gap: 12,
          alignItems: "start",
        }}
      >
        {rows.map((r, idx) => (
          <div
            key={r.id}
            style={{
              border: "1px solid #00000033",
              borderRadius: 8,
              padding: 8,
              width: TOTAL_WIDTH, // enforce outer bounding box width
              boxSizing: "border-box",
            }}
          >
            {/* Two fixed columns: left content, right controls */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `${ROW_WIDTH}px ${CTRL_WIDTH}px`,
                columnGap: GAP,
                alignItems: "start",
              }}
            >
              {/* LEFT: Market panel locked to ROW_WIDTH */}
              <div style={{ width: ROW_WIDTH }}>
                <MarketPricesPanel
                  initial={r.initial}
                  apiBase={apiBase}
                  marketNameIds={namesIds}
                  onFetched={(base) => handleFetched(r.id, base)}
                />
              </div>

              {/* RIGHT: boxed row controls, fixed width */}
              <div
                style={{
                  border: "1px solid #00000055",
                  borderRadius: 8,
                  padding: 5,
                  display: "grid",
                  gridTemplateColumns: "repeat(2, max-content)",
                  gap: "8px 4px",
                  alignItems: "center",
                  justifyItems: "end",
                  width: CTRL_WIDTH,
                  boxSizing: "border-box",
                  justifySelf: "end",
                }}
              >
                <div style={{ fontFamily: "monospace", fontSize: Font, opacity: 0.8 }}>
                  Row {idx + 1}
                </div>
                <button onClick={() => duplicateRow(r.id)} style={{ padding: "2px 8px", fontSize: Font }}>
                  Duplicate
                </button>
                <button onClick={() => removeRow(r.id)} style={{ padding: "2px 8px", fontSize: Font }}>
                  Remove
                </button>
                <button onClick={addRow} style={{ padding: "2px 8px", fontSize: Font }}>
                  + Add market
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Global compare controls (optional) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button
          onClick={() => runCompare()}
          disabled={busy || results.length < 2}
          style={{ padding: "4px 10px", fontSize: 12 }}
          title={results.length < 2 ? "Need at least 2 markets to compare" : "Run your compare function"}
        >
          {busy ? "Comparing…" : "Compare all"}
        </button>
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>results: {results.length}</div>
      </div>

      {/* Downstream consumer */}
      <ComparePanel sources={results} apiBase={apiBase} />

      <ChartsHost
        bounds={{ width: 100, height: 100 }}
        layout={{
          minTotalWidth: TOTAL_WIDTH+10,
          minTotalHeight: 5000,
          baseX: 30,
          staggerX: 28,
          baseY: 50,
          staggerYFactor: 1.2,
          staggerYFixed: 10,
          minFrameWidth: 100,
          minFrameHeight: 100,
          headerHeight: 20,
          innerWidthPct: 1,    // 1 = 100%
          innerHeightPct: 1,   // 1 = 100%
        }}
      />
    </div>

  );
}
