// /mnt/data/MarketPricesPanel.tsx
import React, { useMemo, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import MarketNameSelect from "./MarketNameSelect";
import { DraggablePriceChart } from "./DraggablePriceChart";
import { StatsPanel } from "./StatsPanel";

// ---- Types ----
type PricePoint = { t: number; p: number };            // time and price
type PriceSeries = { name: string; points: PricePoint[] };

type NameIdPair = {
  marketName: string;
  marketID: string;
};

type BaseParams = {
  // base params now take a name-id pair (not a plain string)
  nameID: NameIdPair;
  start: Date | null;
  end: Date | null;
  fidelity: number; // minutes
};

export type ApiResponseGetMarket = {
  base: BaseParams;
  series: PriceSeries;
};

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
): Promise<ApiResponseGetMarket> {
  const res = await fetch(`${apiBase}/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params), // Dates stringify to ISO; strings go through as-is
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => null);
    throw new Error(txt || `HTTP ${res.status}`);
  }

  return (await res.json()) as ApiResponseGetMarket;
}

// Simple adapter so StatsPanel can draw series using your draggable chart
function ChartAdapter({ series }: { series: PriceSeries }) {
  return (
    <DraggablePriceChart
      data={series.points}
      title={`Series: ${series.name}`}
      defaultPosition={{ x: 40, y: 40 }}
      defaultSize={{ width: 150, height: 150 }}
      minHeight={50}
      minWidth={50}
      precision={4}
    />
  );
}

// ---- Props ----
type MarketPricesPanelProps = {
  apiBase?: string;
  initial?: BaseParams;
  // Emit the FULL API response so parent can do handleFetched(r.id, resp)
  onFetched?: (base: BaseParams) => void; // <— now only BaseParams
};

// ---- Component ----
export default function MarketPricesPanel({
  apiBase = API_BASE,
  initial,
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
  const [series, setSeries] = useState<PriceSeries | null>(null);
  const marketName = nameID.marketName;
  const base: BaseParams = { nameID, start, end, fidelity };

  async function go() {
    try {
      setStage("loading");
      setError(null);

      const resp = await fetchPrices(base, apiBase); // fetch call
      setSeries(resp.series);
      setStage("ready");

      // critical change: bubble up the FULL response, not just base
      onFetched?.(base);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch");
      setStage("error");
    }
  }

  // Layout for single draggable chart when ready
  const body = useMemo(() => {
    if (stage !== "ready" || !series) return null;

    const START = { x: 40, y: 40 };
    const SIZE = { width: 200, height: 80 };

    return (
      <DraggablePriceChart
        key={series.name || "series"}
        data={series.points}
        title={`Series: ${series.name ?? ""}`}
        defaultPosition={START}
        defaultSize={SIZE}
        minHeight={50}
        minWidth={50}
        precision={4}
      />
    );
  }, [stage, series, error]);

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
        <StatsPanel base={base} apiBase={API_BASE} Chart={ChartAdapter} />
      </div>

      {/* Body OUTSIDE both boxes */}
      {body && <div style={{ marginTop: 12 }}>{body}</div>}
    </>
  );
}
