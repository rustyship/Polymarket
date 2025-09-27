import type { AlignedData } from "uplot";

export type FrameRect = { x: number; y: number; width: number; height: number };

export type ChartInput = {
  id: string;                 // stable key
  data: number[][];          // [t, y1, y2, ...]
  title: string;
  initial?: FrameRect;
  seriesNames: string[];
  yLabel: string;
  xLabel: string;
  showLegend?: boolean;
}

export type ChartProps = {
  data: AlignedData; // [[time], [y1], [y2], ...]
  width: number;     // container width in px
  height: number;    // total container height in px
  title: string;
  seriesNames: string[];
  showLegend: boolean;
  yLabel: string;
  xLabel: string;
}; 
export type NameIdPair = {
  marketName: string;
  marketID: string;
};

export type BaseParams = {
  // base params now take a name-id pair (not a plain string)
  nameID: NameIdPair;
  start: Date | null;
  end: Date | null;
  fidelity: number; // minutes
};

// Optional global bounds for dragging/resizing
export type ChartsHostProps = {
  inputs: ChartInput[];
  bounds?: { width: number; height: number };
  // Persist position/size if you care; you’ll get id + rect whenever user moves/resizes
  onRectChange?: (id: string, rect: FrameRect) => void;
  // Optional class/style for the whole host canvas
  className?: string;
  style?: React.CSSProperties;
};

export type HitrInput = [string[], (number | string)[]];