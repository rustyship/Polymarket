// /mnt/data/MarketPricesPanel.tsx
import React, { useState } from "react";
import DatePicker from "react-datepicker";

import MarketNameSelect from "./MarketNameSelect";
import { StatsPanel } from "./StatsPanel";
import "react-datepicker/dist/react-datepicker.css";
import { useChartStore } from "./chartStore";
import type { ChartInput } from "./types";
import type { NameIdPair, BaseParams } from "./types";

type MarketPricesPanelProps = {
  apiBase?: string;
  initial?: BaseParams;
  marketNameIds?: NameIdPair[];
  // Emit the FULL API response so parent can do handleFetched(r.id, resp)
  onFetched?: (base: BaseParams) => void; // <— now only BaseParams
};


type alignedDataResponse = {
  alignedData: number[][] | null
}

// push straight to the store
function pushChartToStore(chart: ChartInput) {
  useChartStore.getState().upsert(chart);
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const CONTROL_H = 20;
const controlStyle: React.CSSProperties = {
  height: CONTROL_H,
  lineHeight: `${CONTROL_H}px`,
  padding: "0 8px",
  boxSizing: "border-box",
  fontSize: 10,
};

async function fetchPrices(
  params: BaseParams,
  apiBase: string = API_BASE
): Promise<alignedDataResponse> {
  const res = await fetch(`${apiBase}/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params), // Dates stringify to ISO; strings go through as-is
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => null);
    throw new Error(txt || `HTTP ${res.status}`);
  }

  return (await res.json()) as alignedDataResponse;
}


// ---- Component ----
export default function MarketPricesPanel({
  apiBase = API_BASE,
  initial,
  marketNameIds,
  onFetched,
}: MarketPricesPanelProps) {
  const [stage, setStage] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);

  // Inputs
  const [nameID, setNameID] = useState<NameIdPair>(initial?.nameID ?? { marketName: "", marketID: "" });
  const [start, setStart] = useState<Date | null>(initial?.start ?? new Date());
  const [end, setEnd] = useState<Date | null>(initial?.end ?? new Date());
  const [fidelity, setFidelity] = useState<number>(initial?.fidelity ?? 1);

  // Data: now a single series
  const base: BaseParams = { nameID, start, end, fidelity };

  async function go() {
    try {
      setStage("loading");
      setError(null);

      const resp: alignedDataResponse = await fetchPrices(base, apiBase); // your fetch call
      const data = resp.alignedData;  
      setStage("ready");

      // bubble up whatever you need
      onFetched?.(base);

      // build and send the chart only after success
      if (data) {
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const id = `${base.nameID.marketName},${fmt(base.start)},${fmt(base.end)}`;
        const chart: ChartInput = {
          id: id,
          data: data,
          title: base.nameID.marketName,
          seriesNames: ["p"], // or whatever series you’ve got
          yLabel: "price",
          xLabel: "time",
        };

        pushChartToStore(chart); // Zustand write belongs in handlers/effects, not useMemo
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch");
      setStage("error");
    }
  }

  return (
    <>
      {/* Box 1: controls ONLY */}
      <div
        style={{
          border: "1px solid #000000ff",
          borderRadius: 2,
          padding: 2,
          marginTop: 2,
        }}
      >
        
        <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center", flexWrap: "nowrap" }}>
          <MarketNameSelect
            value={nameID.marketID}
            marketNameIds={marketNameIds}
            onChange={(pair: NameIdPair) => setNameID(pair)}
            apiUrl={`${API_BASE}/markets/names`}
            style={controlStyle}
          />

          <DatePicker
            selected={start}
            onChange={(d: Date | null) => setStart(d)}
            showTimeSelect
            timeIntervals={15}
            dateFormat="Pp"
            placeholderText="start (date/time)"
            customInput={<input style={controlStyle} />}
          />

          <DatePicker
            selected={end}
            onChange={(d: Date | null) => setEnd(d)}
            showTimeSelect
            timeIntervals={15}
            dateFormat="Pp"
            placeholderText="end (date/time)"
            customInput={<input style={controlStyle} />}
          />

          <input
            type="number"
            placeholder="fidelity minutes"
            value={fidelity}
            onChange={(e) => setFidelity(Number(e.target.value || 60))}
            style={{ ...controlStyle, width: 60, marginTop: 5 }}
          />

          <button
            onClick={go}
            style={{
              height: CONTROL_H,
              lineHeight: `${CONTROL_H}px`,
              padding: "0 10px",
              boxSizing: "border-box",
              fontSize: 12,
              color: "#e71700ff",
            }}
          >
            Fetch
          </button>

          <div
            role="status"
            aria-live="polite"
            style={{
              height: CONTROL_H,
              lineHeight: `${CONTROL_H}px`,
              padding: "0 10px",
              boxSizing: "border-box",
              fontSize: 12,
            }}
          >
            {stage === "loading" ? "Loading…" : error ?? ""}
          </div>
        </div>
      </div>

      {/* Box 2: stats */}
      <div style={{ marginTop: 8 }}>
        <StatsPanel base={base} apiBase={API_BASE} />
      </div>
    </>
  );
}
