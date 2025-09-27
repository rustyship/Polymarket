// /mnt/data/UPlot.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import uPlot, { type AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ChartProps } from "./types";

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



export default function UplotChart({
  data,
  width,
  height,
  title,
  seriesNames,
  showLegend = true,
  yLabel,
  xLabel,
}: ChartProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);     // where uPlot mounts
  const uplotRef = useRef<uPlot | null>(null);
  const legendHostRef = useRef<HTMLDivElement | null>(null); // where we’ll mount uPlot's legend

  // Keep the custom header slim and predictable for layout math
  const headerH = 36;

  const seriesMeta = useMemo(() => {
    const palette = [
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ];

    const ser: uPlot.Series[] = [
      { label: xLabel },
      ...seriesNames.map((nm, i) => ({
        label: nm,
        stroke: palette[i % palette.length],
        width: 1.5,
      })),
    ];
    return ser;
  }, [seriesNames, xLabel]);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const opts: uPlot.Options = {
      width: Math.floor(width),
      height: Math.max(0, Math.floor(height - headerH)), // graph sits under header
      title: "", // disable built-in title
      scales: { x: { time: true } },
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
      legend: { show: showLegend, live: true }, // still updates values on hover
      cursor: { focus: { prox: 24 } },
      plugins: [wheelZoomPlugin(0.20)],
    };

    const u = new uPlot(opts, data, el);
    uplotRef.current = u;

    // Move the auto-generated legend into our header's right-side container
    if (showLegend && legendHostRef.current) {
      const legendEl = u.root.querySelector(".u-legend") as HTMLElement | null;
      if (legendEl) {
        legendHostRef.current.innerHTML = ""; // just in case of remounts
        legendHostRef.current.appendChild(legendEl);
        // Make legend fit nicely in a tight header
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
    // Rebuild only if these impact the uPlot instance structure
  }, [showLegend, xLabel, yLabel, seriesMeta, data, width, height]);

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
            // 2-line clamp with ellipsis:
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "normal",
            maxWidth: "50%", // optional: prevent legend from getting crushed
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
