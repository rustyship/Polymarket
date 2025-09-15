// ComparePanel.tsx
// Displays:
//   - price lines from backend `lines` as [[t], [p1], [p2], ...]
//   - r² as a numeric table only, with backend providing a flat row-major list (length == n*n)
//   - hit rate as a simple table (percentages), when provided by backend

import React, { useCallback, useMemo, useState } from "react";
import DraggableResizableUplot from "./DraggableResizableUplot";
// ===== Types =====
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

type CompareFeature = "r2" | "lines" | "hit_rate";

export type CompareResponse = {
  // Flat row-major r² list. For n sources, length must be n*n.
  rsquared: number[] | null;
  // [[time], [p1], [p2], ...]
  lines: number[][] | null;
  // map of marketName -> hit rate (either 0..1 or 0..100); rendered below
  hitr: Record<string, number> | null;
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
    hitr: (obj?.hitr ?? null) as Record<string, number> | null,
  };
}

// Strict reshape: throws if `flat.length !== n*n`.
function reshapeFlatR2(flat: number[], n: number): number[][] {
  if (!Number.isInteger(n) || n <= 0 || flat.length !== n * n) {
    throw new Error(`r² length ${flat.length} != n*n (${n}²)`);
  }
  return Array.from({ length: n }, (_, i) => flat.slice(i * n, (i + 1) * n));
}

// Minimal table for r² numbers
function R2Table({
  flat,
  labels,
  decimals = 3,
}: {
  flat: number[];
  labels: string[];
  decimals?: number;
}) {
  let z: number[][] = [];
  let err: string | null = null;

  try {
    z = reshapeFlatR2(flat, labels.length);
  } catch (e: any) {
    err = e?.message || "Invalid r² payload";
  }

  // optional: copy as CSV
  const copyCSV = () => {
    if (!z.length) return;
    const header = ["", ...labels].join(",");
    const rows = z.map((row, i) => [labels[i], ...row.map(v => Number.isFinite(v) ? v.toFixed(decimals) : "")].join(","));
    const csv = [header, ...rows].join("\n");
    navigator.clipboard?.writeText(csv).catch(() => { });
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>r² values</div>
        <button onClick={copyCSV} style={{ padding: "2px 8px", fontSize: 12 }}>copy CSV</button>
      </div>

      {err ? (
        <div style={{ color: "#b00", fontFamily: "monospace" }}>{err}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ccc" }}></th>
                {labels.map(x => (
                  <th key={x} style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {z.map((row, i) => (
                <tr key={labels[i]}>
                  <td style={{ padding: "4px 6px", borderRight: "1px solid #eee" }}>{labels[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #f0f0f0" }}>
                      {Number.isFinite(v) ? v.toFixed(decimals) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Hit rate table
function HitrTable({
  hitr,
  labels,
  decimals = 10,
}: {
  hitr: Record<string, number>;
  labels: string[]; // preferred display order
  decimals?: number;
}) {
  const fmt = (v: number | undefined) => {
    if (!Number.isFinite(v as number)) return "—";
    let p = v as number;
    if (Math.abs(p) <= 1) p *= 100; // accept ratio or percent
    return `${p.toFixed(decimals)}%`;
  };

  const rows = labels.map((name, i) => {
    const raw = (hitr as any)[name] ?? (hitr as any)[`p${i + 1}`];
    const val = typeof raw === "string" ? parseFloat(raw) : raw;
    return { name, val: (Number.isFinite(val as number) ? (val as number) : undefined) };
  });

  const copyCSV = () => {
    const header = "name,hit_rate_%";
    const lines = rows.map(r => `${r.name},${Number.isFinite(r.val as number) ? (() => {
      let p = r.val as number; if (Math.abs(p) <= 1) p *= 100; return p.toFixed(decimals);
    })() : ""}`);
    const csv = [header, ...lines].join("\n");
    navigator.clipboard?.writeText(csv).catch(() => { });
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>hit rate</div>
        <button onClick={copyCSV} style={{ padding: "2px 8px", fontSize: 12 }}>copy CSV</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ccc" }}>series</th>
              <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #ccc" }}>hit rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td style={{ padding: "4px 6px", borderRight: "1px solid #eee" }}>{r.name}</td>
                <td style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid #f0f0f0" }}>{fmt(r.val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

      {/* Lines: [[t],[p1],[p2],...] */}
      {resp?.lines ? (
        <div style={{ marginTop: 12 }}>
          {(() => {
            const names = sources.map(s => s.nameID.marketName);
            return (
                <DraggableResizableUplot
                  data={resp.lines}
                  seriesNames={names}
                  initial={{ x: 32, y: 24, width: 720, height: 360 }}
                  bounds={{ width: 1000, height: 600 }}
                  title="Prices"
                />
            );
          })()}
        </div>
      ) : null}

      {/* r² table (no plotting) */}
      {resp?.rsquared ? (
        <R2Table
          flat={resp.rsquared}
          labels={sources.map(s => s.nameID.marketName)}
          decimals={10}
        />
      ) : null}

      {/* hit rate table */}
      {resp?.hitr && Object.keys(resp.hitr).length > 0 ? (
        <HitrTable
          hitr={resp.hitr}
          labels={sources.map(s => s.nameID.marketName)}
          decimals={10}
        />
      ) : null}
    </div>
  );
}
