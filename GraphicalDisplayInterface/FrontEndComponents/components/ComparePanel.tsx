// ComparePanel.tsx
// Displays:
//   - price lines from backend `lines` as [[t], [p1], [p2], ...]
//   - r² as a numeric table only, with backend providing a flat row-major list (length == n*n)
//   - hit rate as a simple table (percentages), when provided by backend

import React, { useCallback, useMemo, useState } from "react";
import type { ChartInput, HitrInput, BaseParams } from "./types";
import { pushChartToStore } from "./Functions";
import { HitrTable } from "./HitRateTable";
import { R2Table } from "./RSquaredTable";

type CompareFeature = "r2" | "lines" | "hit_rate";

type CompareResponse = {
  // Flat row-major r² list. For n sources, length must be n*n.
  rsquared: number[] | null;
  // [[time], [p1], [p2], ...]
  lines: number[][] | null;
  // map of marketName -> hit rate (either 0..1 or 0..100); rendered below
  hitr: HitrInput;
  //marketNames List
  marketNames: string[]
};

// ===== Config =====
const DEFAULT_API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ===== Helpers =====
function toISO(d: Date | null) {
  return d ? new Date(d).toISOString() : null;
}

function packPayload(
  sources: BaseParams[],
  features: CompareFeature[],
  r2_window?: number,
  hit_rate_window?: number
) {
  return {
    sources: sources.map(s => ({
      nameID: s.nameID,
      start: toISO(s.start),
      end: toISO(s.end),
      fidelity: s.fidelity,
    })),
    features,
    r2_window: r2_window ?? null,
    hit_rate_window: hit_rate_window ?? null,
  };
}

async function callComparePOST(
  apiBase: string,
  sources: BaseParams[],
  features: CompareFeature[],
  r2_window?: number,
  hit_rate_window?: number
): Promise<CompareResponse> {
  const url = `${apiBase}/compare`;
  const payload = packPayload(sources, features, r2_window, hit_rate_window);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => null);
    throw new Error(txt || `HTTP ${res.status}`);
  }

  const obj = await res.json();
  return {
    rsquared: (obj?.rsquared ?? null) as number[] | null,
    lines: (obj?.lines ?? null) as number[][] | null,
    hitr: (obj?.hitr ?? null) as HitrInput,
    marketNames: (obj?.marketNames) as string[],
  };
}


// ===== Component =====
export type ComparePanelProps = {
  sources: BaseParams[];
  apiBase?: string;

  defaultR2?: boolean;
  defaultLines?: boolean;
  defaultHitRate?: boolean;
  defaultR2Window?: number;
  defaultHitRateWindow?: number;

  onResponse?: (resp: CompareResponse) => void;
};

export default function ComparePanel({
  sources,
  apiBase = DEFAULT_API_BASE,

  defaultR2 = true,
  defaultLines = true,
  defaultHitRate = false,
  defaultR2Window = 60,
  defaultHitRateWindow = 60,

  onResponse,
}: ComparePanelProps) {
  const [selR2, setSelR2] = useState(defaultR2);
  const [selLines, setSelLines] = useState(defaultLines);
  const [selHit, setSelHit] = useState(defaultHitRate);

  const [r2Win, setR2Win] = useState(defaultR2Window);
  const [hitWin, setHitWin] = useState(defaultHitRateWindow);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resp, setResp] = useState<CompareResponse | null>(null);

  const features = useMemo(() => {
    const f: CompareFeature[] = [];
    if (selR2) f.push("r2");
    if (selLines) f.push("lines");
    if (selHit) f.push("hit_rate");
    return f;
  }, [selR2, selLines, selHit]);

  const canRun = (sources?.length ?? 0) >= 2 && features.length >= 1 && !busy;

  const concatMarketNames = (bases: BaseParams[], sep = ", "): string =>
          bases.map(b => b.nameID.marketName).join(sep);

  const runCompare = useCallback(async () => {
    if (!canRun) return;
    try {
      setBusy(true);
      setErr(null);
      const out = await callComparePOST(
        apiBase,
        sources,
        features,
        selR2 ? r2Win : undefined,
        selHit ? hitWin : undefined
      );
      setResp(out);

      const linesData = out.lines

      if (linesData) {
        const fmt = (d?: Date | null) => (d ? d.toISOString() : "");
        const base = sources[0]
        const names = concatMarketNames(sources)
        const id = `${names},${fmt(base.start)},${fmt(base.end)}LINES`;
        const chart: ChartInput = {
          id: id,
          data: linesData,
          title: "Lines",
          seriesNames: sources.map(sources => sources.nameID.marketName), // or whatever series you’ve got
          yLabel: "price",
          xLabel: "time",
        };
        pushChartToStore(chart);
      }
      onResponse?.(out);
    } catch (e: any) {
      setErr(e?.message || "compare failed");
    } finally {
      setBusy(false);
    }
  }, [apiBase, sources, features, selR2, r2Win, selHit, hitWin, canRun, onResponse]);

  return (
    <div style={{ marginTop: 12 }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label><input type="checkbox" checked={selR2} onChange={e => setSelR2(e.target.checked)} /> r²</label>
        <input
          type="number"
          value={r2Win}
          onChange={e => setR2Win(Math.max(1, +e.target.value || 1))}
          style={{ width: 72 }}
          title="r² window"
          disabled={!selR2}
        />

        <label><input type="checkbox" checked={selLines} onChange={e => setSelLines(e.target.checked)} /> lines</label>

        <label><input type="checkbox" checked={selHit} onChange={e => setSelHit(e.target.checked)} /> hit rate</label>
        <input
          type="number"
          value={hitWin}
          onChange={e => setHitWin(Math.max(1, +e.target.value || 1))}
          style={{ width: 72 }}
          title="hit rate window"
          disabled={!selHit}
        />

        <button onClick={runCompare} disabled={!canRun} style={{ padding: "4px 10px", fontSize: 12 }}>
          {busy ? "Comparing…" : "Run compare"}
        </button>

        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#334" }}>
          sources: {(sources?.length ?? 0)} • features: {features.join(", ") || "none"}
        </div>
      </div>

      {/* Error */}
      {err ? (
        <div style={{ marginTop: 8, color: "#b00", fontFamily: "monospace" }}>{err}</div>
      ) : null}

      {/* r² table (no plotting) */}
      {resp?.rsquared ? (
        <R2Table
          flat={resp.rsquared}
          labels={resp.marketNames}
        />
      ) : null}

      {/* hit rate table */}
      {resp?.hitr && Object.keys(resp.hitr).length > 0 ? (
        <HitrTable
          data={resp.hitr}
        />
      ) : null}
    </div>
  );
}
