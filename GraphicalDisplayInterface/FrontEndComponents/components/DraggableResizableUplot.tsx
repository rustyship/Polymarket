// DraggableResizableUplot.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { AlignedData } from "uplot";

// helper: number[][] -> Float64Array[] (ms→s handled)
function toAlignedData(input: number[][]): AlignedData {
  if (!input || input.length === 0) return [] as unknown as AlignedData;

  const t = input[0] ?? [];
  const ms = t.length > 0 && Math.max(...t) > 1e12;
  const tSec = ms ? t.map(v => v / 1000) : t;

  // build typed arrays for all columns
  const cols = [tSec, ...input.slice(1)];
  const typed = cols.map(col => Float64Array.from(col));

  // uPlot’s TS defs expect a TypedArray[], which Float64Array is
  return typed as unknown as AlignedData;
}
type UPlotData = number[][];

type Props = {
  data: UPlotData;                    // [[time], [y1], [y2], ...]
  seriesNames?: string[];             // optional names for y series (not including time); defaults to "S1", "S2", ...
  colors?: string[];                  // optional line colors; cycles if fewer than series
  initial?: { x: number; y: number; width: number; height: number }; // px
  bounds?: { width: number; height: number }; // drag bounds (container client size)
  title?: string;
  showLegend?: boolean;
};

function isEpochMillis(xs: number[]): boolean {
  // crude but effective: 13-digit epoch in ms vs ~10-digit seconds
  // treat anything past year ~33658 as "yeah no"
  if (!xs.length) return false;
  const max = Math.max(...xs);
  return max > 1e12;
}

function normalizeData(input: UPlotData): UPlotData {
  if (!input || input.length < 2) return input;
  const t = input[0];
  if (!t.length) return input;

  // auto-convert ms -> s because uPlot defaults to seconds for time axes
  if (isEpochMillis(t)) {
    const tSec = t.map(v => v / 1000);
    return [tSec, ...input.slice(1)];
  }
  return input;
}

// Simple wheel zoom and drag-pan plugin for uPlot
function wheelZoomPlugin(factor = 0.2): uPlot.Plugin {
  let over: HTMLElement | null = null;

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  return {
    hooks: {
      ready: (u: uPlot) => {
        over = u.root.querySelector(".u-over") as HTMLElement;
        if (!over) return;

        // Zoom around cursor with wheel
        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();

            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const left = e.clientX - rect.left;

            const xVal = u.posToVal(left, "x");
            const { min, max } = u.scales.x!;

            const scale = e.deltaY < 0 ? 1 - factor : 1 + factor;

            const newMin = xVal - (xVal - min!) * scale;
            const newMax = xVal + (max! - xVal) * scale;

            // don’t let it collapse to nothing or explode
            const spanMin = 1e-9;
            if (newMax - newMin > spanMin) {
              u.setScale("x", { min: newMin, max: newMax });
            }
          },
          { passive: false }
        );

        // Drag pan with left mouse
        let dragging = false;
        let xMin0 = 0;
        let xMax0 = 0;
        let startX = 0;

        const onDown = (e: MouseEvent) => {
          // ignore right or middle
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

// A minimal draggable + resizable wrapper with no external deps.
// Drag by the header. Resize with the bottom-right handle.
export default function DraggableResizableUplot({
  data,
  seriesNames,
  colors,
  initial = { x: 24, y: 24, width: 600, height: 320 },
  bounds,
  title = "uPlot",
  showLegend = true,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);

  const [pos, setPos] = useState({ x: initial.x, y: initial.y });
  const [size, setSize] = useState({ width: initial.width, height: initial.height });

  // Drag the outer frame by header
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const header = frame.querySelector<HTMLElement>(".dr-header");
    if (!header) return;

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = pos.x;
      startTop = pos.y;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      let nx = startLeft + (e.clientX - startX);
      let ny = startTop + (e.clientY - startY);

      if (bounds) {
        nx = Math.max(0, Math.min(bounds.width - size.width, nx));
        ny = Math.max(0, Math.min(bounds.height - size.height, ny));
      }

      setPos({ x: nx, y: ny });
    };

    const onUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
    };

    header.addEventListener("mousedown", onDown);
    return () => header.removeEventListener("mousedown", onDown);
  }, [bounds, pos.x, pos.y, size.height, size.width]);

  // Resize with a corner handle
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const handle = frame.querySelector<HTMLElement>(".dr-resize");
    if (!handle) return;

    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let resizing = false;

    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = size.width;
      startH = size.height;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp, { once: true });
    };

    const onMove = (e: MouseEvent) => {
      if (!resizing) return;
      const dw = e.clientX - startX;
      const dh = e.clientY - startY;

      let newW = Math.max(260, startW + dw);
      let newH = Math.max(180, startH + dh);

      if (bounds) {
        newW = Math.min(newW, bounds.width - pos.x);
        newH = Math.min(newH, bounds.height - pos.y);
      }

      setSize({ width: newW, height: newH });
    };

    const onUp = () => {
      resizing = false;
      window.removeEventListener("mousemove", onMove);
    };

    handle.addEventListener("mousedown", onDown);
    return () => handle.removeEventListener("mousedown", onDown);
  }, [bounds, pos.x, pos.y, size.height, size.width]);

  // Build uPlot and keep it in sync
    const aligned = useMemo(() => toAlignedData(data), [data]);

  // Memo series metadata
  const seriesMeta = useMemo(() => {
    const n = Math.max(0, (aligned?.length || 1) - 1);
    const names = seriesNames && seriesNames.length >= n
      ? seriesNames.slice(0, n)
      : Array.from({ length: n }, (_, i) => `S${i + 1}`);

    // mildly nice default palette
    const palette = colors && colors.length ? colors : [
      "#1f77b4","#ff7f0e","#2ca02c","#d62728",
      "#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf",
    ];

    const ser: uPlot.Series[] = [
      { label: "Time" },
      ...names.map((nm, i) => ({
        label: nm,
        stroke: palette[i % palette.length],
        width: 1.5,
      })),
    ];
    return ser;
  }, [colors, aligned?.length, seriesNames]);

  // Create / destroy uPlot
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el || !aligned || aligned.length < 2) return;

    // clear any previous
    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const opts: uPlot.Options = {
      width: Math.floor(size.width),
      height: Math.floor(size.height - 36), // leave room for header
      title,
      scales: { x: { time: true } },
      axes: [
        {
          grid: { show: true },
          label: "Time",
          // show datetimes nicely
          values: (u, vals) => vals.map(v => new Date(v * 1000).toLocaleString()),
        },
        { grid: { show: true }, label: "Price" },
      ],
      series: seriesMeta,
      legend: { show: showLegend },
      cursor: { focus: { prox: 24 } },
      plugins: [wheelZoomPlugin(0.20)],
      // disable built-in selection to make drag-pan feel clean
    };

    const u = new uPlot(opts, aligned, el);
    uplotRef.current = u;

    return () => {
      u.destroy();
      uplotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotRef, aligned, seriesMeta, showLegend, size.height, size.width, title]);

  // Keep size synced when outer frame resizes (from our handle or external)
  useEffect(() => {
    const u = uplotRef.current;
    if (!u) return;
    u.setSize({ width: Math.floor(size.width), height: Math.floor(size.height - 36) });
  }, [size.height, size.width]);

  // If data changes but instance exists, update
  useEffect(() => {
    const u = uplotRef.current;
    if (u && aligned) {
      u.setData(aligned);
    }
  }, [aligned]);

  // Observe parent size changes too
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ro = new ResizeObserver(() => {
      const u = uplotRef.current;
      if (!u) return;
      u.setSize({ width: Math.floor(frame.clientWidth), height: Math.floor(frame.clientHeight - 36) });
    });
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="dr-frame"
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        borderRadius: 8,
        background: "#fff",
        border: "1px solid #ddd",
        display: "grid",
        gridTemplateRows: "36px 1fr",
        userSelect: "none",
      }}
    >
      <div
        className="dr-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          fontSize: 12,
          background: "#f6f6f6",
          borderBottom: "1px solid #e5e5e5",
          cursor: "move",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ marginLeft: "auto", fontFamily: "monospace", opacity: 0.6 }}>
          drag to move • wheel to zoom • drag inside plot to pan
        </div>
      </div>

      <div ref={plotRef} style={{ position: "relative" }} />

      <div
        className="dr-resize"
        title="Drag to resize"
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 14,
          height: 14,
          cursor: "nwse-resize",
          background:
            "linear-gradient(135deg, transparent 0 40%, rgba(0,0,0,0.08) 40% 60%, transparent 60% 100%)",
          borderBottomRightRadius: 8,
        }}
      />
    </div>
  );
}
