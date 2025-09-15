// DraggableMacdBands.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";
import { Rnd } from "react-rnd";

// ---- your types ----
type PricePoint = { t: number; p: number };
type PriceSeries = { name: string; points: PricePoint[] };

// ---- fill-between plugin (same idea as before) ----
function signBandsPlugin(opts: { fastIdx: number; slowIdx: number; colorPos?: string; colorNeg?: string; yScale?: string }): uPlot.Plugin {
  const colorPos = opts.colorPos ?? "#1fa22e";
  const colorNeg = opts.colorNeg ?? "#c61e1e";
  const yScale = opts.yScale ?? "y";
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx as CanvasRenderingContext2D;
        const x = u.data[0] as number[];
        const yf = u.data[opts.fastIdx] as (number | null)[];
        const ys = u.data[opts.slowIdx] as (number | null)[];
        if (!x || !yf || !ys || x.length < 2) return;

        const xPx = (vx: number) => u.valToPos(vx, "x", true);
        const yPx = (vy: number) => u.valToPos(vy, yScale, true);

        ctx.save();
        ctx.beginPath();
        ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        ctx.clip();
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "destination-over";

        const n = x.length;
        let i = 0;
        while (i < n - 1) {
          while (i < n - 1 && (yf[i] == null || ys[i] == null || yf[i + 1] == null || ys[i + 1] == null)) i++;
          if (i >= n - 1) break;

          let df0 = (yf[i] as number) - (ys[i] as number);
          let sign = df0 >= 0;

          const up: { x: number; y: number }[] = [];
          const lo: { x: number; y: number }[] = [];
          up.push({ x: xPx(x[i]), y: yPx(sign ? (yf[i] as number) : (ys[i] as number)) });
          lo.push({ x: xPx(x[i]), y: yPx(sign ? (ys[i] as number) : (yf[i] as number)) });

          let k = i;
          for (; k < n - 1; k++) {
            const x0 = x[k], x1 = x[k + 1];
            const yf0 = yf[k] as number, ys0 = ys[k] as number;
            const yf1 = yf[k + 1] as number, ys1 = ys[k + 1] as number;
            if ([yf0, ys0, yf1, ys1].some(v => v == null)) break;

            const df1 = yf1 - ys1;
            const nextSign = df1 >= 0;

            if (nextSign !== sign) {
              // crossing inside segment
              const denom = (yf1 - yf0) - (ys1 - ys0);
              const t = denom !== 0 ? (ys0 - yf0) / denom : 0.5;
              const xC = x0 + t * (x1 - x0);
              const yC = yf0 + t * (yf1 - yf0);

              up.push({ x: xPx(xC), y: yPx(yC) });
              lo.push({ x: xPx(xC), y: yPx(yC) });

              // draw current polygon
              ctx.beginPath();
              ctx.moveTo(up[0].x, up[0].y);
              for (let m = 1; m < up.length; m++) ctx.lineTo(up[m].x, up[m].y);
              for (let m = lo.length - 1; m >= 0; m--) ctx.lineTo(lo[m].x, lo[m].y);
              ctx.closePath();
              ctx.fillStyle = sign ? colorPos : colorNeg;
              ctx.globalAlpha = 0.35;
              ctx.fill();
              ctx.globalAlpha = 1;

              // start a new run from crossing with flipped sign
              sign = nextSign;
              up.length = 0; lo.length = 0;
              up.push({ x: xPx(xC), y: yPx(yC) });
              lo.push({ x: xPx(xC), y: yPx(yC) });
            }

            // extend run to k+1
            const upVal = sign ? yf1 : ys1;
            const loVal = sign ? ys1 : yf1;
            up.push({ x: xPx(x1), y: yPx(upVal) });
            lo.push({ x: xPx(x1), y: yPx(loVal) });
          }

          // final run close
          if (up.length > 1) {
            ctx.beginPath();
            ctx.moveTo(up[0].x, up[0].y);
            for (let m = 1; m < up.length; m++) ctx.lineTo(up[m].x, up[m].y);
            for (let m = lo.length - 1; m >= 0; m--) ctx.lineTo(lo[m].x, lo[m].y);
            ctx.closePath();
            ctx.fillStyle = sign ? colorPos : colorNeg;
            ctx.globalAlpha = 0.35;
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          i = Math.max(k, i + 1);
        }

        ctx.globalCompositeOperation = prevComp;
        ctx.restore();
      },
    },
  };
}

// ---- the chart, created once; resizes via u.setSize ----
function MacdUplotBandChart({
  fast, slow, width, height, parent,
}: {
  fast: PriceSeries; slow: PriceSeries; width: number; height: number; parent: HTMLDivElement | null;
}) {
  const plotRef = useRef<uPlot | null>(null);

  const data: AlignedData = useMemo(() => {
    const n = Math.min(fast.points.length, slow.points.length);
    const xs = new Float64Array(n);
    const yf = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = fast.points[i].t * 1000;    // ms
      yf[i] = fast.points[i].p;
      ys[i] = slow.points[i].p;
    }
    return [xs, yf, ys];
  }, [fast.points, slow.points]);

  // create once
  useEffect(() => {
    if (!parent) return;
    const u = new uPlot(
      {
        width, height,
        cursor: { drag: { x: true, y: false } },
        scales: { x: { time: true }, y: { auto: true } },
        axes: [
          { stroke: "#667085", grid: { show: false } },
          { stroke: "#667085", grid: { stroke: "#e5e7eb", width: 1 } },
        ],
        series: [
          {},
          { label: fast.name || "Fast", width: 1, stroke: "#0ea5e9", points: { show: false } },
          { label: slow.name || "Slow", width: 1, stroke: "#64748b", points: { show: false } },
        ],
        plugins: [signBandsPlugin({ fastIdx: 1, slowIdx: 2 })],
      },
      data,
      parent
    );
    plotRef.current = u;
    return () => { u.destroy(); plotRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent]); // create only when parent exists

  // update data when series change
  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  // resize smoothly on outer size changes
  useEffect(() => {
    if (plotRef.current) plotRef.current.setSize({ width, height });
  }, [width, height]);

  return null;
}

// ---- wrapper with RND frame ----
export default function DraggableMacdBands({
  fast, slow,
  title = "MACD (fast vs slow)",
  initial = { x: 40, y: 40, w: 200, h: 150 },
}: { fast: PriceSeries; slow: PriceSeries; title?: string; initial?: { x:number;y:number;w:number;h:number } }) {
  const [pos, setPos] = useState({ x: initial.x, y: initial.y });
  const [size, setSize] = useState({ width: initial.w, height: initial.h });
  const holderRef = useRef<HTMLDivElement | null>(null);

  const HEADER = 36;

  return (
    <Rnd
      size={size}
      position={pos}
      onDragStop={(_, d) => setPos({ x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, p) => {
        setPos({ x: pos.x + p.x, y: pos.y + p.y });
        setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
      }}
      dragHandleClassName="drag-handle"
      bounds="window"
      minWidth={177}
      minHeight={220}
      style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
    >
      <div className="drag-handle" style={{
        height: HEADER, display: "flex", alignItems: "center", padding: "0 10px",
        fontWeight: 600, fontSize: 13, color: "#334", borderBottom: "1px solid #eef1f4", cursor: "move", userSelect: "none"
      }}>
        {title}
      </div>

      <div ref={holderRef} style={{ width: "100%", height: size.height - HEADER }}>
        <MacdUplotBandChart
          fast={fast}
          slow={slow}
          width={size.width}
          height={size.height - HEADER}
          parent={holderRef.current}
        />
      </div>
    </Rnd>
  );
}