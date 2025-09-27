import React, { useState, useRef, useCallback, useMemo } from "react";
import { useChartStore } from "./chartStore";
import UplotChart from "./UPlot";
import DraggableResizableContainer from "./DraggableResizeableContainer";
import type { DraggableResizableHandle } from "./DraggableResizeableContainer";
import type { AlignedData } from "uplot";
import UplotMACDChart from "./UplotMACD";

type InitialMode = "live" | "frozen";

// === Public layout knobs ===
export type ChartsHostLayout = {
  // Host minima
  minTotalWidth?: number;   // default 200
  minTotalHeight?: number;  // default 140

  // Frame sizing
  minFrameWidth?: number;   // default 320
  minFrameHeight?: number;  // default 220
  headerHeight?: number;    // default 0 (subtract from chart height if you render a header)

  // Initial Bounds
  initWidth?: number;
  initHeight?: number;

  // Frame placement
  baseX?: number;           // default 24
  staggerX?: number;        // default 24 (also used as horizontal gutter)
  baseY?: number;           // default 24
  staggerYFactor?: number;  // default 0.15 of perH
  staggerYFixed?: number;   // default 20 px extra gutter



  // Inner content scale inside each frame (0..1). Apply ONCE.
  innerWidthPct?: number;   // default 1
  innerHeightPct?: number;  // default 1

  // Optional absolute overrides for total size; if set, they win over bounds.
  totalWidth?: number;
  totalHeight?: number;

  // Visual padding inside each draggable frame content area
  innerPadding?: number;    // default 8 px

  // Host overflow control
  clipOverflow?: boolean;   // default true
};

export type ChartsHostProps = {
  // Required: provide host size explicitly, or compute it with a ResizeObserver and pass it in.
  bounds: { width: number; height: number };
  className?: string;
  style?: React.CSSProperties;
  layout?: ChartsHostLayout;
};

export default function ChartsHost({ bounds, className, style, layout }: ChartsHostProps) {
  // Subscribe to chart array; re-renders when store changes.
  const charts = useChartStore((s) => s.charts);

  // Resolve layout with sane defaults
  const {
    minTotalWidth = 200,
    minTotalHeight = 140,

    minFrameWidth = 320,
    minFrameHeight = 220,

    headerHeight = 0,

    initWidth = 300,
    initHeight = 300,

    baseX = 24,
    staggerX = 24,
    baseY = 24,
    staggerYFixed = 20,

    totalWidth,
    totalHeight,


    innerWidthPct = 1,
    innerHeightPct = 1,
    innerPadding = 8,
    clipOverflow = true,
  } = layout ?? {};

  const clearCharts = useChartStore((s) => s.clear);

  // Host dimensions from inputs (no % strings, no hidden fallbacks)
  const resolvedW = typeof totalWidth === "number" ? totalWidth : bounds.width;
  const resolvedH = typeof totalHeight === "number" ? totalHeight : bounds.height;

  const totalW = Math.max(minTotalWidth, Math.floor(resolvedW));
  const totalH = Math.max(minTotalHeight, Math.floor(resolvedH));


  // Gaps between frames (reuse staggers as gutters)
  const colGap = Math.max(0, staggerX);

  // How many columns can actually fit
  const cols = Math.max(
    1,
    Math.floor((totalW - baseX * 2 + colGap) / (initWidth + colGap))
  );


  const [initialMode, setInitialMode] = useState<InitialMode>("live");


  // Precompute inner scaling and padding
  const pad2 = innerPadding * 2;

  const isEmpty = !charts || charts.length === 0;

  const refMap = useRef<Map<string, DraggableResizableHandle>>(new Map());
  const initialMapRef = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const attachRef = useCallback(
    (id: string) => (h: DraggableResizableHandle | null) => {
      if (h) refMap.current.set(id, h);
      else refMap.current.delete(id);
    },
    []
  );


  const getFrozenInitial = (id: string, i: number) => {
    const m = initialMapRef.current;
    const existing = m.get(id);
    if (existing) return existing;
    const t = targetRectForIndex(i);
    m.set(id, t);
    return t;
  };

  const targetRectForIndex = useCallback(
    (i: number) => ({
      x: baseX + (i % cols) * (initWidth + colGap),
      y: baseY + Math.floor(i / cols) * (initHeight + staggerYFixed),
      width: initWidth,
      height: initHeight,
    }),
    [baseX, cols, initWidth, colGap, baseY, initHeight, staggerYFixed]
  );

  const getInitialFor = useMemo(
    () =>
      (id: string, i: number) =>
        initialMode === "frozen" ? getFrozenInitial(id, i) : targetRectForIndex(i),
    [initialMode, targetRectForIndex]
  );

  const removeChart = useChartStore((s) => s.remove);

  const autoOrient = () => {
    charts.forEach((c, i) => {
      const t = targetRectForIndex(i);
      refMap.current.get(c.id)?.resetTo(t.x, t.y, t.width, t.height);
    });
  };

  const setFrozenCacheFromScreen = () => {
  const liveIds = new Set(charts.map(c => c.id));
  // prune stale ids
  for (const k of [...initialMapRef.current.keys()]) if (!liveIds.has(k)) initialMapRef.current.delete(k);

  charts.forEach(c => {
    const h = refMap.current.get(c.id);
    const r = h?.getRect?.();
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0) {
      initialMapRef.current.set(c.id, r);
    }
  });
};

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: totalW,
        height: totalH,
        border: "1px solid #000000ff",
        overflow: clipOverflow ? "hidden" : undefined,
        ...style,
      }}
    >
      <button
        onClick={clearCharts}
        title="Reset charts"
        aria-label="Reset charts"
        style={{
          height: 40,
          lineHeight: "20px",
          padding: "0 10px",
          boxSizing: "border-box",
          fontSize: 20,
          position: "absolute",
          top: 8,
          left: 160,
          zIndex: 10,
        }}
      >
        Reset
      </button>

      <button
        onClick={autoOrient}
        style={{
          height: 40,
          lineHeight: "20px",
          padding: "0 10px",
          boxSizing: "border-box",
          fontSize: 20,
          position: "absolute",
          top: 8,
          left: 20,
          zIndex: 10,
        }}
        title="Reset positions into a neat grid"
      >
        Auto orient
      </button>

      <div style={{ display: "flex", left: 240, top: 13, zIndex: 10, gap: 8, position: "absolute", }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, userSelect: "none" }}>
          <span style={{ fontSize: 20 }}>
            Initial layout mode: {initialMode === "frozen" ? "Frozen" : "Live"}
          </span>
          <label style={{
            position: "relative", width: 44, height: 24, display: "inline-block",
            borderRadius: 999, background: initialMode === "frozen" ? "#22c55e" : "#aaa",
            cursor: "pointer"
          }}>
            <input
              type="checkbox"
              checked={initialMode === "frozen"}
              onChange={e => setInitialMode(e.target.checked ? "frozen" : "live")}
              style={{ display: "none" }}
            />
            <span style={{
              position: "absolute",
              top: 2, left: initialMode === "frozen" ? 22 : 2,
              width: 20, height: 20, borderRadius: "50%", background: "#fff",
              transition: "left 120ms ease"
            }} />
          </label>
        </label>
      </div>

      <button
        type="button"
        style={{
          height: 40,
          lineHeight: "20px",
          padding: "0 10px",
          boxSizing: "border-box",
          fontSize: 20,
          position: "absolute",
          top: 8,
          left: 540,
          zIndex: 10,
        }}
        onClick={setFrozenCacheFromScreen}
        title="Sets new frozen cache"
      >
        Set Cache
      </button>

      {isEmpty ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            opacity: 0.7,
            userSelect: "none",
          }}
        >
          No charts yet.
        </div>
      ) : (
        charts.map((chart: any, i: number) => (
          <DraggableResizableContainer
            key={chart.id}
            ref={attachRef(chart.id)}
            bounds={{ width: totalW, height: totalH }}
            initial={getInitialFor(chart.id, i)}
          >
            {(rect) => {
              const scaledW = Math.max(0, Math.floor(rect.width * innerWidthPct));
              const scaledH = Math.max(0, Math.floor(rect.height * innerHeightPct));
              const chartW = Math.max(0, scaledW - pad2);
              const chartH = Math.max(0, scaledH - pad2 - headerHeight);
              const ChartImpl = /macd/i.test(chart.id) ? UplotMACDChart : UplotChart;

              return (
                <div
                  style={{
                    position: "relative",                 // ← so the close button can anchor
                    width: scaledW,
                    height: scaledH,
                    padding: innerPadding,
                    boxSizing: "border-box",
                  }}
                >
                  <button
                    title="Remove chart"
                    aria-label={`Remove ${chart.title ?? "chart"}`}
                    onMouseDown={(e) => e.stopPropagation()}      // don't trigger drag
                    onClick={(e) => { e.stopPropagation(); removeChart(chart.id); }}
                    style={{
                      position: "absolute",
                      top: Math.max(2, innerPadding / 2),
                      right: Math.max(2, innerPadding / 2),
                      zIndex: 20,
                      height: 20,
                      lineHeight: "20px",
                      padding: "0 8px",
                      fontSize: 12,
                      cursor: "pointer",
                      border: "1px solid #00000055",
                      borderRadius: 6,
                      background: "#fff",
                    }}
                  >
                    ✕
                  </button>

                  <ChartImpl
                    data={chart.data as AlignedData}
                    width={chartW}
                    height={chartH}
                    title={chart.title}
                    seriesNames={chart.seriesNames}
                    showLegend={chart.showLegend ?? true}
                    yLabel={chart.yLabel ?? "Value"}
                    xLabel={chart.xLabel ?? "Time"}
                  />
                </div>
              );
            }}
          </DraggableResizableContainer>
        ))
      )}
    </div>
  );
}