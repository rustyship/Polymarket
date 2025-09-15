// MultiMarketPanel.tsx
import React, { useCallback, useMemo, useState, useEffect } from "react";
import MarketPricesPanel from "./MarketPricesPanel";
import ComparePanel from "./ComparePanel";

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

 return (
    <div style={{ padding: 8 }}>
      {/* Rows */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr max-content", gap: 12, alignItems: "start" }}>
        {rows.map((r, idx) => (
          <div key={r.id} style={{ border: "1px solid #00000033", borderRadius: 8, padding: 8 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 2,
                alignItems: "start",
              }}
            >
              {/* LEFT: stack the MarketPricesPanel (stats will live under it) */}
              <div>
                <MarketPricesPanel
                  initial={r.initial}
                  apiBase={apiBase}
                  onFetched={(base) => handleFetched(r.id, base)}
                />
              </div>

              {/* RIGHT: boxed row controls */}
              <div
                
                style={{
                  border: "1px solid #00000055",
                  borderRadius: 8,
                  padding: 5,                          // small box padding
                  display: "grid",
                  gridTemplateColumns: "repeat(2, max-content)", // 2 columns, content-tight
                  gap: "8px 4px",                              // minimal grid gap
                  alignItems: "center",
                  justifyItems: "end",                 // keep items right-aligned in each cell
                  width: "max-content",                // shrink box to contents
                  justifySelf: "end",                  // stick box to the right edge
                }}
              >
                <div style={{ fontFamily: "monospace", fontSize: Font, opacity: 0.8 }}>
                  Row {idx + 1}
                </div>
                <button onClick={() => duplicateRow(r.id)} style={{ padding: "2px 8px", fontSize: Font}}>
                  Duplicate
                </button>
                <button onClick={() => removeRow(r.id)} style={{ padding: "2px 8px", fontSize: Font}}>
                  Remove
                </button>
                <button onClick={addRow} style={{ padding: "2px 8px", fontSize: Font}}>
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
    </div>
  );
}
