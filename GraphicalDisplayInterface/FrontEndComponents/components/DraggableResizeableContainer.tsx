import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";

export type FrameRect = { x: number; y: number; width: number; height: number };

type ContainerProps = {
  initial?: FrameRect; // starting position/size in px
  bounds?: { width: number; height: number }; // optional drag/resize bounds
  className?: string;
  style?: React.CSSProperties;
  // Render-prop: we pass the current rect to children so they can lay out accordingly
  children: (rect: FrameRect) => React.ReactNode;
  onChange?: (rect: FrameRect) => void; // optional callback when rect changes
  // Optional minimums (kept compatible with previous 100px implicit minimums)
  minWidth?: number;
  minHeight?: number;
};

export type DraggableResizableHandle = {
  /** Reset using a full rect */
  reset: (next: FrameRect) => void;
  /** Reset using positional args */
  resetTo: (x: number, y: number, width: number, height: number) => void;

  getRect: () => FrameRect;     
};

const DraggableResizableContainer = forwardRef<DraggableResizableHandle, ContainerProps>(
  (
    {
      initial = { x: 24, y: 24, width: 600, height: 320 },
      bounds,
      className,
      style,
      children,
      onChange,
      minWidth = 100,
      minHeight = 100,
    },
    ref
  ) => {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const first = useRef(initial);
    const [rect, setRect] = useState(first.current); // use only once
    const rectRef = useRef(rect);
    useEffect(() => { rectRef.current = rect; }, [rect]);

    // Keep local state in sync if "initial" prop changes
    useEffect(() => {
      setRect(prev => {
        // if identical, skip
        if (
          prev.x === initial.x &&
          prev.y === initial.y &&
          prev.width === initial.width &&
          prev.height === initial.height
        ) return prev;
        return clampToBounds(initial, bounds, minWidth, minHeight);
      });
    }, [initial.x, initial.y, initial.width, initial.height, bounds, minWidth, minHeight]);

    // Expose imperative reset API
    useImperativeHandle(
      ref,
      (): DraggableResizableHandle => ({
        reset: (next: FrameRect) => {
          const clamped = clampToBounds(next, bounds, minWidth, minHeight);
          setRect(() => {
            onChange?.(clamped);
            return clamped;
          });
        },
        resetTo: (x: number, y: number, width: number, height: number) => {
          const next = { x, y, width, height };
          const clamped = clampToBounds(next, bounds, minWidth, minHeight);
          setRect(() => {
            onChange?.(clamped);
            return clamped;
          });
        },
        getRect: () => rectRef.current,     
      }),
      [bounds, onChange, minWidth, minHeight]
    );

    // Drag by a thin, invisible top overlay so inner content still gets interactions.
    useEffect(() => {
      const frame = frameRef.current;
      if (!frame) return;
      const grab = frame.querySelector<HTMLElement>(".dr-grab") || frame;

      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let dragging = false;

      const onDown = (e: MouseEvent) => {
        if (!(e.target instanceof HTMLElement)) return;
        if (!grab.contains(e.target)) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.x;
        startTop = rect.y;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp, { once: true });
      };

      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        let nx = startLeft + (e.clientX - startX);
        let ny = startTop + (e.clientY - startY);

        if (bounds) {
          nx = Math.max(0, Math.min(bounds.width - rect.width, nx));
          ny = Math.max(0, Math.min(bounds.height - rect.height, ny));
        }

        setRect(r => {
          const next = { ...r, x: nx, y: ny };
          onChange?.(next);
          return next;
        });
      };

      const onUp = () => {
        dragging = false;
        window.removeEventListener("mousemove", onMove);
      };

      frame.addEventListener("mousedown", onDown);
      return () => frame.removeEventListener("mousedown", onDown);
    }, [bounds, rect.width, rect.height, rect.x, rect.y, onChange]);

    // Resize with a bottom-right handle (invisible but hit-tested)
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
        startW = rect.width;
        startH = rect.height;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp, { once: true });
      };

      const onMove = (e: MouseEvent) => {
        if (!resizing) return;
        const dw = e.clientX - startX;
        const dh = e.clientY - startY;

        let newW = Math.max(minWidth, startW + dw);
        let newH = Math.max(minHeight, startH + dh);

        if (bounds) {
          newW = Math.min(newW, bounds.width - rect.x);
          newH = Math.min(newH, bounds.height - rect.y);
        }

        setRect(r => {
          const next = { ...r, width: newW, height: newH };
          onChange?.(next);
          return next;
        });
      };

      const onUp = () => {
        resizing = false;
        window.removeEventListener("mousemove", onMove);
      };

      handle.addEventListener("mousedown", onDown);
      return () => handle.removeEventListener("mousedown", onDown);
    }, [bounds, rect.x, rect.y, rect.width, rect.height, onChange, minWidth, minHeight]);

    return (
      <div
        ref={frameRef}
        className={["dr-frame", className].filter(Boolean).join(" ")}
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          borderRadius: 8,
          background: "#fff",
          border: "1px solid #f60810ff",
          display: "grid",
          gridTemplateRows: "1fr", // no header row
          userSelect: "none",
          ...style,
        }}
      >
        {/* Invisible drag strip that does NOT consume layout height */}
        <div
          className="dr-grab"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 10,
            cursor: "move",
            background: "transparent",
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            zIndex: 2,
          }}
        />

        {/* child render with live rect */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {children(rect)}
        </div>

        {/* Invisible resize handle in the corner */}
        <div
          className="dr-resize"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: "nwse-resize",
            background: "transparent",
            borderBottomRightRadius: 8,
            zIndex: 3,
          }}
        />
      </div>
    );
  }
);

export default DraggableResizableContainer;

// Helpers
function clampToBounds(
  rect: FrameRect,
  bounds: { width: number; height: number } | undefined,
  minW: number,
  minH: number
): FrameRect {
  const width = Math.max(minW, rect.width);
  const height = Math.max(minH, rect.height);

  if (!bounds) {
    return { ...rect, width, height };
  }

  const maxX = Math.max(0, bounds.width - width);
  const maxY = Math.max(0, bounds.height - height);

  const x = Math.min(Math.max(0, rect.x), maxX);
  const y = Math.min(Math.max(0, rect.y), maxY);

  return { x, y, width, height };
}
