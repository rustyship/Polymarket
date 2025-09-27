import React, { useState } from "react";
import type { AlignedData } from "uplot";
import { pushChartToStore } from "./Functions";

// ---------------- types ----------------
import type { BaseParams } from "./types";

// Mirror of Python `class StatsSummary(BaseModel)`
export type StatsSummary = {
  mean: number;
  min: number;
  max: number;
  stdex: number; // matches backend field
};

// Mirror of Python `class StatsResponse(BaseModel)`
export type StatsResponse = {
  macdHistData : number[][]
  macdSigMacdData : number[][]
  smaData: number[][]
  trendData: number[][]
  volatility: number | null;
  volume: number | null;
  stats: StatsSummary | null;
};

type StatsPanelProps = {
  base: BaseParams;
  apiBase?: string; // defaults to VITE_API_URL or http://localhost:8000
  // Pass your existing chart component here. It will be called as <Chart series={s} />
};

// ---------------- helpers ----------------

function isReady(base: BaseParams) {
  return Boolean(base.nameID.marketName && base.start && base.end && base.fidelity);
}
function useApiBase(apiBase?: string) {
  return apiBase || (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";
}


export interface StatsInput {
  base_params: BaseParams;
  features: string[];
  sma_window?: number | null;
  macd_fast?: number | null;
  macd_slow?: number | null;
  vol_window?: number | null;
  trend_degree?: number | null;
}

// ---- POST helper ----
export async function postStats(
  url: string,
  base: BaseParams,
  opts?: {
    features?: string[];
    sma_window?: number | null;
    macd_fast?: number | null;
    macd_slow?: number | null;
    vol_window?: number | null;
    trend_degree?: number | null;
  }
): Promise<StatsResponse> {
  const body: StatsInput = {
    base_params: base,                    // passed through as-is
    features: opts?.features ?? [],
    sma_window: opts?.sma_window ?? null,
    macd_fast: opts?.macd_fast ?? null,
    macd_slow: opts?.macd_slow ?? null,
    vol_window: opts?.vol_window ?? null,
    trend_degree: opts?.trend_degree ?? null,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }

  return (await res.json()) as StatsResponse;
}
// ---------------- the panel ----------------
export function StatsPanel({ base, apiBase}: StatsPanelProps) {
  const api = useApiBase(apiBase);
  const disabled = !isReady(base);

  // toggles
  const [incStats, setIncStats] = useState(true);
  const [incTrend, setIncTrend] = useState(true);
  const [incSMA, setIncSMA] = useState(true);
  const [incMACD, setIncMACD] = useState(false);
  const [incVol, setIncVol] = useState(false);
  const [incVolume, setIncVolume] = useState(false);

  // params
  const [smaWin, setSmaWin] = useState(20);
  const [macdFast, setMacdFast] = useState(12);
  const [macdSlow, setMacdSlow] = useState(26);
  const [volWin, setVolWin] = useState(30);
  const [trendDeg, setTrendDeg] = useState(1);

  // results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [volatility, setVolatility] = useState<number | null>(null);
  const [volume, setVolume] = useState<number | null>(null);

  async function onGetStats() {
    setLoading(true);
    setError(null);
    try {
      const feats = [
        incStats && "stats",
        incTrend && "trend",
        incSMA && "sma",
        incMACD && "macd",
        incVol && "volatility",
        incVolume && "volume",
      ].filter(Boolean) as string[];

      const resp = await postStats(`${api}/stats`, base, {
        features: feats ?? [],
        // send nulls (explicit) or undefined (omitted); either is fine with the helper
        sma_window: incSMA ? smaWin : null,
        macd_fast: incMACD ? macdFast : null,
        macd_slow: incMACD ? macdSlow : null,
        vol_window: incVol ? volWin : null,
        trend_degree: incTrend ? trendDeg : null,
      });
      
      setStats(resp.stats ?? null)
      setVolatility(resp.volatility ?? null)
      setVolume(resp.volume ?? null)
      
      const macdHistData = resp.macdHistData
      const macdSigMacdData = resp.macdSigMacdData
      const smaData = resp.smaData
      const trendData = resp.trendData

      if (macdHistData) {
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const id = `${base.nameID.marketName},${fmt(base.start)},${fmt(base.end)}MACDHist`;
        const chart = {
          id: id,
          data: macdHistData,
          title: `${base.nameID.marketName}MACD`,
          seriesNames: ["Macd"],
          yLabel: "price",
          xLabel: "time"
        }
        pushChartToStore(chart)
      }

      if (macdSigMacdData) {
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const id = `${base.nameID.marketName},${fmt(base.start)},${fmt(base.end)}SigHist`;
        const chart = {
          id: id,
          data: macdSigMacdData,
          title: `${base.nameID.marketName}MACD`,
          seriesNames: ["Macd","Sig"],
          yLabel: "price",
          xLabel: "time"
        }
        pushChartToStore(chart)
      }

      if (smaData) {
        console.log(smaData)
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const id = `${base.nameID.marketName},${fmt(base.start)},${fmt(base.end)}SMA`;
        const chart = {
          id: id,
          data: smaData,
          title: `${base.nameID.marketName}SMA`,
          seriesNames: ["SMA"],
          yLabel: "price",
          xLabel: "time"
        }
        pushChartToStore(chart)
      }

      if (trendData) {
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const id = `${base.nameID.marketName},${fmt(base.start)},${fmt(base.end)}TREND`;
        const chart = {
          id: id,
          data: trendData,
          title: `${base.nameID.marketName}Trend`,
          seriesNames: ["trend"],
          yLabel: "price",
          xLabel: "time"
        }
        pushChartToStore(chart)
      }

      

    } catch (e: any) {
    setError(e?.message ?? "Failed to get stats");
  } finally {
    setLoading(false);
  }
}

return (
  <>
    <div
      style={{
        border: "1px solid #000000ff",
        borderRadius: 2,
        padding: 2,
        marginTop: 2,
      }}
    >
      {/* shared control styles */}
      {(() => {
        const FONT = "10pt";
        // @ts-ignore
        (window as any).__ctl = {
          row: { display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", fontSize: FONT } as const,
          label: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: FONT, lineHeight: 1.2 } as const,
          number: { fontSize: FONT, height: 15, lineHeight: 1.2, padding: "2px 3px", boxSizing: "border-box" } as const,
          check: { width: 10, height: 10 } as const,
          btn: {
            padding: "0 6px",          // no commas
            borderRadius: 0,
            fontSize: "12px",            // consider 8–9px if clipping
            height: 12,
            lineHeight: "12px",        // must be a string for px
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            overflow: "hidden",
            whiteSpace: "nowrap",
            color: "#e71700ff"
          } as const,
        };
        return null;
      })()}

      <div style={(window as any).__ctl.row}>
        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incStats}
            onChange={(e) => setIncStats(e.target.checked)}
          />
          basic stats
        </label>

        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incTrend}
            onChange={(e) => setIncTrend(e.target.checked)}
          />
          trend
        </label>

        <input
          type="number"
          title="trend degree"
          value={trendDeg}
          onChange={(e) => setTrendDeg(Math.max(1, +e.target.value || 1))}
          style={{ ...(window as any).__ctl.number, width: 64 }}
        />

        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incSMA}
            onChange={(e) => setIncSMA(e.target.checked)}
          />
          sma
        </label>

        <input
          type="number"
          title="SMA window"
          value={smaWin}
          onChange={(e) => setSmaWin(Math.max(2, +e.target.value || 20))}
          style={{ ...(window as any).__ctl.number, width: 72 }}
        />

        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incMACD}
            onChange={(e) => setIncMACD(e.target.checked)}
          />
          macd
        </label>

        <input
          type="number"
          title="MACD fast"
          value={macdFast}
          onChange={(e) => {
            const v = Math.max(2, +e.target.value || 12);
            setMacdFast(v);
          }}
          style={{ ...(window as any).__ctl.number, width: 64 }}
        />

        <input
          type="number"
          title="MACD slow"
          value={macdSlow}
          min={macdFast + 1}
          onChange={(e) => setMacdSlow(Math.max(macdFast + 1, 3, +e.target.value || 26))}
          style={{ ...(window as any).__ctl.number, width: 64 }}
        />

        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incVol}
            onChange={(e) => setIncVol(e.target.checked)}
          />
          volatility
        </label>

        <input
          type="number"
          title="Vol window"
          value={volWin}
          onChange={(e) => setVolWin(Math.max(2, +e.target.value || 30))}
          style={{ ...(window as any).__ctl.number, width: 72 }}
        />

        <label style={(window as any).__ctl.label}>
          <input
            type="checkbox"
            style={(window as any).__ctl.check}
            checked={incVolume}
            onChange={(e) => setIncVolume(e.target.checked)}
          />
          volume
        </label>

        <button onClick={onGetStats} disabled={disabled || loading} style={(window as any).__ctl.btn}> {loading ? "Crunching..." : "Get stats"} </button>
      </div>

      {error && <div style={{ marginTop: 8, color: "#b91c1c" }}>{error}</div>}

      {(stats || volatility != null || volume != null) && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "baseline",
            marginTop: 12,
            fontFamily: "monospace",
            color: "#334",
          }}
        >
          {stats && (
            <div>
              mean: {stats.mean.toFixed(4)} • min: {stats.min.toFixed(4)} • max: {stats.max.toFixed(4)} • stdex:{" "}
              {stats.stdex.toFixed(4)}
            </div>
          )}

          {(volatility != null || volume != null) && (
            <div>
              {volatility != null ? <>volatility: {Number(volatility).toFixed(6)}</> : null}
              {volatility != null && volume != null ? " • " : null}
              {volume != null ? <>volume: {Number(volume).toFixed(2)}</> : null}
            </div>
          )}
        </div>
      )}

    </div>
  </>
);
}