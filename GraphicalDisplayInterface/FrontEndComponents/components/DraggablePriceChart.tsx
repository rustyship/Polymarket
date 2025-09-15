import { useMemo, useRef, useEffect, useState } from "react";
import { Rnd } from "react-rnd";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import "./charts.css";

export type PricePoint = { t: number; p: number };

export type DraggablePriceChartProps = {
  data: PricePoint[];                         // t: unix seconds, p: price
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  timeZone?: string;                           // not applied; pass pre-shifted times if needed
  title?: string;
  showGrid?: boolean;
  precision?: number;
  yDomain?: [number, number] | "auto";
  className?: string;
  style?: React.CSSProperties;
};

function formatPrice(v: number, precision = 4) {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function DraggablePriceChart({
  data,
  defaultPosition = { x: 80, y: 80 },
  defaultSize = { width: 200, height: 200 },
  minWidth = 50,
  minHeight = 50,
  // timeZone,
  title = "Price over Time",
  showGrid = true,
  precision = 4,
  yDomain = "auto",
  className,
  style,
}: DraggablePriceChartProps) {
  const [size, setSize] = useState(defaultSize);
  const [position, setPosition] = useState(defaultPosition);

  // Layout numbers
  const headerRatio = 0.1;
  const ratio = Math.min(Math.max(headerRatio, 0.02), 0.5);
  const PAD = 12; // inner padding around chart area
  const headerPx = Math.round(size.height * ratio);
  const innerHeight = Math.max(size.height - headerPx - PAD * 2, 160);
  const innerWidth = Math.max(size.width - PAD * 2, 160);

  // Convert input data once
  const { xMs, yVals } = useMemo(() => {
    const n = Array.isArray(data) ? data.length : 0;
    const x = new Float64Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = data[i].t;   // seconds
      y[i] = data[i].p;
    }
    return { xMs: x, yVals: y };
  }, [data]);

  const hasData = xMs.length > 0;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Build options object independent of data so we can detect when a rebuild is needed
  const opts: Options = useMemo(() => {
    
    const yRange = yDomain === "auto" ? undefined : (u: uPlot, _min: number, _max: number) => yDomain;

    return {
      width: innerWidth,
      height: innerHeight,
      scales: {
        x: { time: true },
        y: { range: yRange },
      },
      class: "uplot-vertical-labels",
      axes: [
        {
          grid: { show: showGrid },
          ticks: { show: true },
          font: "11px system-ui, sans-serif",
          values: (_, ticks) =>
            ticks.map(t =>
              new Date(t * 1000).toLocaleString([], {
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: false,
              })
            ),
          rotate: () => -90,   
          size: Math.max(72, Math.min(100, Math.round(innerHeight * 0.28))), // extra space for vertical labels
          gap: 6,
        },
        {
          grid: { show: showGrid },
          ticks: { show: true },
          values: (u, ticks) => ticks.map(t => String(t)),
        },
      ],
      series: [
        {},
        {
          label: "p",
          stroke: "#3355ff",
          width: 1,
        },
      ],
      cursor: {
        y: true,
        x: true,
        points: { show: false },
        font: "10px",
        bind: {
          mousemove: (u, targ, handler) => handler,
        },
      },
      // No JS label-rotation hooks anymore. CSS handles it.
    };
  }, [innerWidth, innerHeight, showGrid, yDomain, title]);

  // Create / destroy chart when options change
  useEffect(() => {
    const host = plotRef.current;
    if (!host) return;

    // Clear previous content
    host.innerHTML = "";

    // Handle empty data state
    if (!hasData) {
      const empty = document.createElement("div");
      empty.style.cssText = `display:grid;place-items:center;height:${innerHeight}px;color:#6b7280;font-size:13px`;
      empty.textContent = "No data";
      host.appendChild(empty);

      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
      return;
    }

    // Destroy existing instance before recreating
    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    // Create tooltip element
    const tip = document.createElement("div");
    tip.style.cssText =
      `position:absolute;pointer-events:none;background:#111;color:#fff;` +
      `padding:4px 6px;border-radius:4px;font-size:11px;opacity:0;` +
      `transform:translate(-50%, -120%);white-space:nowrap;`;
    tooltipRef.current = tip;

    // Create chart
    const inst = new uPlot(opts, [xMs, yVals], host);
    uplotRef.current = inst;

    // Append tooltip on top of chart canvas
    const over = host.querySelector(".u-over");
    if (over) over.appendChild(tip);

    // Cursor/tooltip logic
    inst.setCursor({ left: 0, top: 0 });

    inst.root.addEventListener("mousemove", () => {
      const c = inst.cursor;
      const idx = c.idx ?? -1;
      if (idx < 0 || idx >= yVals.length) {
        tip.style.opacity = "0";
        return;
      }
      const x = xMs[idx];
      const y = yVals[idx];

      // x is seconds; display as ms
      tip.textContent = `Price: ${formatPrice(y, precision)} | ${new Date(x * 1000).toLocaleString()}`;
      tip.style.left = c.left + "px";
      tip.style.top = c.top + "px";
      tip.style.opacity = "1";
    });

    inst.root.addEventListener("mouseleave", () => {
      if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
    });

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [opts, hasData, xMs, yVals, precision, innerHeight]);

  // Update size without full rebuild when only container size changes
  useEffect(() => {
    if (uplotRef.current) {
      uplotRef.current.setSize({ width: innerWidth, height: innerHeight });
    }
  }, [innerWidth, innerHeight]);

  // Update data efficiently if arrays change but options didn't
  useEffect(() => {
    if (uplotRef.current && hasData) {
      uplotRef.current.setData([xMs, yVals]);
    }
  }, [xMs, yVals, hasData]);

  return (
    <Rnd
      bounds="window"
      size={size}
      position={position}
      minWidth={minWidth}
      minHeight={minHeight}
      dragHandleClassName="drag-handle"
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, pos) => {
        setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
        setPosition(pos);
      }}
      className={
        "rounded-2xl border border-gray-200 bg-white/90 backdrop-blur shadow-lg " + (className || "")
      }
      style={{ ...style }}
    >
      <div ref={rootRef} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
        <div
          className="drag-handle"
          style={{
            height: headerPx,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: "1px solid #e5e7eb",
            padding: "8px 12px",
            cursor: "grab",
            userSelect: "none",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#1f2937",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ flex: "1 1 0%", minHeight: 0, padding: PAD }}>
          {/* Scope CSS to this host so vertical labels apply reliably */}
          <div
            ref={plotRef}
            className="uplot-vertical-labels"
            style={{ width: innerWidth, height: innerHeight, position: "relative" }}
          />
        </div>
      </div>
    </Rnd>
  );
}
