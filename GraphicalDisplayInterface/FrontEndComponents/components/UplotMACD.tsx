import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import uPlot, { type AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";

export type ChartProps = {
  data: AlignedData; // [times, macdHist]
  width: number;
  height: number;
  title: string;
  seriesNames: string[];
  showLegend: boolean;
  yLabel: string;
  xLabel: string;
};

// same tiny plugin you used: wheel-zoom + left-drag pan
function wheelZoomPlugin(factor = 0.2): uPlot.Plugin {
  let over: HTMLElement | null = null;

  return {
    hooks: {
      ready: (u: uPlot) => {
        over = u.root.querySelector(".u-over") as HTMLElement;
        if (!over) return;

        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const left = e.clientX - rect.left;

            const xVal = u.posToVal(left, "x");
            const sx = u.scales.x!;
            const scale = e.deltaY < 0 ? 1 - factor : 1 + factor;
            const newMin = xVal - (xVal - sx.min!) * scale;
            const newMax = xVal + (sx.max! - xVal) * scale;

            if (newMax - newMin > 1e-9) u.setScale("x", { min: newMin, max: newMax });
          },
          { passive: false }
        );

        let dragging = false;
        let xMin0 = 0;
        let xMax0 = 0;
        let startX = 0;

        const onDown = (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          dragging = true;
          startX = e.clientX;
          const sx = u.scales.x!;
          xMin0 = sx.min!;
          xMax0 = sx.max!;
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp, { once: true });
        };

        const onMove = (e: MouseEvent) => {
          if (!dragging) return;
          const dxPx = e.clientX - startX;
          const pxPerUnit = u.bbox.width / (xMax0 - xMin0);
          const dxVal = dxPx / pxPerUnit;
          u.setScale("x", { min: xMin0 - dxVal, max: xMax0 - dxVal });
        };

        const onUp = () => {
          dragging = false;
          window.removeEventListener("mousemove", onMove);
        };

        over.addEventListener("mousedown", onDown);
      },
    },
  };
}

// helpers
function minMax(arr: number[]) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: 0, max: 0 };
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.05;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

export default function UplotMACDHistogram({
  data,
  width,
  height,
  title,
  seriesNames,
  showLegend,
  yLabel,
  xLabel,
}: ChartProps) {
  // same structure: header row + plot area
  const headerH = 36;

  const plotRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const legendHostRef = useRef<HTMLDivElement | null>(null);

  // enforce [x,y] shape
  const [xs, ys] = useMemo(() => {
    const x = (data?.[0] as number[]) ?? [];
    const y = (data?.[1] as number[]) ?? [];
    return [x, y];
  }, [data]);

  const yRange = useMemo<[number, number]>(() => {
    const { min, max } = minMax(ys);
    const span = Math.max(1e-9, max - min);
    const pad = span * 0.08;
    return [min - pad, max + pad];
  }, [ys]);

  // series meta mirrors your base component: we define a dummy line series but draw bars via hook
  const seriesMeta = useMemo<uPlot.Series[]>(() => {
    return [
      { label: xLabel }, // x
      {
        label: seriesNames?.[0] ?? "MACD Histogram",
        points: { show: false },
        stroke: "transparent",
        fill: "transparent",
      },
    ];
  }, [xLabel, seriesNames]);

  useLayoutEffect(() => {
    const host = plotRef.current;
    if (!host) return;

    // rebuild cleanly
    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const opts: uPlot.Options = {
      width: Math.floor(width),
      height: Math.max(0, Math.floor(height - headerH)),
      title: "",
      scales: {
        x: { time: true },
        y: { auto: false, range: () => yRange },
      },
      axes: [
        {
          gap: 0,
          grid: { show: true },
          label: xLabel,
          font: "8px",
          size: 20,
        },
        {
          gap: 0,
          grid: { show: true },
          label: yLabel,
          font: "8px",
          size: 40,
        },
      ],
      series: seriesMeta,
      legend: { show: showLegend, live: true },
      cursor: { focus: { prox: 24 } },
      plugins: [wheelZoomPlugin(0.2)],
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx as CanvasRenderingContext2D;
            const xVals = xs;
            const yVals = ys;

            if (!xVals || !yVals || xVals.length !== yVals.length || xVals.length === 0) return;

            const zeroY = u.valToPos(0, "y", true);

            // estimate bar width as ~80% of min x-gap in pixels
            let minDxPx = Infinity;
            for (let i = 1; i < xVals.length; i++) {
              const dxPx = Math.abs(u.valToPos(xVals[i], "x", true) - u.valToPos(xVals[i - 1], "x", true));
              if (dxPx && dxPx < minDxPx) minDxPx = dxPx;
            }
            if (!Number.isFinite(minDxPx)) minDxPx = 6;
            const barW = Math.max(1, Math.floor(minDxPx * 0.8));

            for (let i = 0; i < xVals.length; i++) {
              const xv = xVals[i];
              const yv = yVals[i];
              if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;

              const xPx = u.valToPos(xv, "x", true);
              const yPx = u.valToPos(yv, "y", true);

              const left = Math.round(xPx - barW / 2);
              const top = Math.round(Math.min(yPx, zeroY));
              const h = Math.abs(Math.round(yPx - zeroY));
              if (h < 1) continue;

              ctx.fillStyle = yv >= 0 ? "rgba(16, 185, 129, 0.9)" : "rgba(239, 68, 68, 0.9)";
              ctx.fillRect(left, top, barW, h);
            }

            // zero line on top
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(120,120,120,0.8)";
            ctx.lineWidth = 1;
            ctx.moveTo(Math.round(u.bbox.left), Math.round(zeroY));
            ctx.lineTo(Math.round(u.bbox.left + u.bbox.width), Math.round(zeroY));
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };

    const u = new uPlot(opts, data, host);
    uplotRef.current = u;

    // hoist legend into header right, just like your base chart
    if (showLegend && legendHostRef.current) {
      const legendEl = u.root.querySelector(".u-legend") as HTMLElement | null;
      if (legendEl) {
        legendHostRef.current.innerHTML = "";
        legendHostRef.current.appendChild(legendEl);
        legendEl.style.display = "flex";
        legendEl.style.alignItems = "center";
        legendEl.style.gap = "2px";
        legendEl.style.flexWrap = "wrap";
        legendEl.style.fontSize = "8px";
      }
    }

    return () => {
      u.destroy();
      uplotRef.current = null;
    };
  }, [data, height, showLegend, width, xLabel, yLabel, seriesMeta, yRange]);

  // keep size/data in sync without full rebuild
  useEffect(() => {
    const u = uplotRef.current;
    if (u) u.setSize({ width: Math.floor(width), height: Math.max(0, Math.floor(height - headerH)) });
  }, [width, height]);

  useEffect(() => {
    const u = uplotRef.current;
    if (u) u.setData(data);
  }, [data]);

  return (
    <div style={{ position: "relative", width, height, display: "flex", flexDirection: "column" }}>
      {/* Row 1: Title | Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: headerH,
          padding: "0 8px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1.2,
            paddingRight: 2,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "normal",
            maxWidth: "50%",
          }}
          title={title}
        >
          {title}
        </div>

        <div
          ref={legendHostRef}
          style={{
            display: showLegend ? "flex" : "none",
            alignItems: "center",
            overflow: "hidden",
            flex: "0 1 auto",
          }}
        />
      </div>

      {/* Row 2: Graph */}
      <div ref={plotRef} style={{ position: "relative", width: "100%", height: `calc(100% - ${headerH}px)` }} />
    </div>
  );
}
