// push straight to the store
import { useChartStore } from "./chartStore";
import type { ChartInput } from "./types";

export function pushChartToStore(chart: ChartInput) {
  useChartStore.getState().upsert(chart);
}