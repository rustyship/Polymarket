// chartStore.tsx
import { create } from "zustand";
import { devtools, persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import localforage from "localforage";
import type { ChartInput, FrameRect } from "./types";

// --- IndexedDB storage via localforage ---
const lf = localforage.createInstance({
  name: "charts-db",          // DB name
  storeName: "charts-store",  // object store name
  description: "Zustand charts state"
});

const idbStorage: StateStorage = {
  getItem: async (name) => (await lf.getItem<string>(name)) ?? null,
  setItem: async (name, value) => { await lf.setItem(name, value); },
  removeItem: async (name) => { await lf.removeItem(name); },
};

// Optional: graceful fallback if IndexedDB is unavailable (very rare, private mode edge cases)
function withFallback(storage: StateStorage): StateStorage {
  // if anything throws during a probe, no-op the persistence instead of crashing
  const probeKey = "__probe__";
  return {
    getItem: async (n) => {
      try { await storage.setItem(probeKey, "1"); await storage.removeItem(probeKey); }
      catch { return null; }
      return storage.getItem(n);
    },
    setItem: async (n, v) => {
      try { await storage.setItem(n, v); } catch { /* ignore, act like ephemeral */ }
    },
    removeItem: async (n) => {
      try { await storage.removeItem(n); } catch { /* ignore */ }
    },
  };
}

type State = {
  charts: ChartInput[];                        // ordered list for rendering
  indexById: Record<string, number>;          // O(1) lookup
  hydrated: boolean;                           // ← optional: true after IndexedDB rehydrate
};

type Actions = {
  clear: () => void;

  // Add only if missing
  add: (c: ChartInput) => void;

  // Add or replace (by id)
  upsert: (c: ChartInput) => void;

  // Add or replace many (keeps order stable; new ones appended)
  upsertMany: (cs: ChartInput[]) => void;

  // Update only some fields of a chart (no remount if your components are memoized)
  patch: (id: string, patch: Partial<Omit<ChartInput, "id">>) => void;

  // Replace just the data payload (common hot path)
  setData: (id: string, data: ChartInput["data"]) => void;

  // Update position/size only (nice to wire into your draggable container’s onChange)
  setRect: (id: string, rect: FrameRect) => void;

  remove: (id: string) => void;

  // Optional: reorder in the array (drag to front/back, etc.)
  move: (id: string, toIndex: number) => void;
};

export const useChartStore = create<State & Actions>()(
  devtools(
    persist(
      (set, get) => ({
        charts: [],
        indexById: {},
        hydrated: false,

        clear: () => set({ charts: [], indexById: {} }, false, "charts/clear"),

        add: (c) =>
          set((s) => {
            if (s.indexById[c.id] !== undefined) return s;
            const nextIdx = s.charts.length;
            return {
              charts: [...s.charts, c],
              indexById: { ...s.indexById, [c.id]: nextIdx },
            };
          }, false, `charts/add/${c.id}`),

        upsert: (c) =>
          set((s) => {
            const idx = s.indexById[c.id];
            if (idx === undefined) {
              const nextIdx = s.charts.length;
              return {
                charts: [...s.charts, c],
                indexById: { ...s.indexById, [c.id]: nextIdx },
              };
            }
            const next = s.charts.slice();
            next[idx] = { ...next[idx], ...c };
            return { charts: next };
          }, false, `charts/upsert/${c.id}`),

        upsertMany: (cs) =>
          set((s) => {
            let charts = s.charts.slice();
            let indexById = { ...s.indexById };
            for (const c of cs) {
              const idx = indexById[c.id];
              if (idx === undefined) {
                indexById[c.id] = charts.length;
                charts.push(c);
              } else {
                charts[idx] = { ...charts[idx], ...c };
              }
            }
            return { charts, indexById };
          }, false, "charts/upsertMany"),

        patch: (id, patch) =>
          set((s) => {
            const idx = s.indexById[id];
            if (idx === undefined) return s;
            const next = s.charts.slice();
            next[idx] = { ...next[idx], ...patch };
            return { charts: next };
          }, false, `charts/patch/${id}`),

        setData: (id, data) =>
          set((s) => {
            const idx = s.indexById[id];
            if (idx === undefined) return s;
            const next = s.charts.slice();
            next[idx] = { ...next[idx], data };
            return { charts: next };
          }, false, `charts/setData/${id}`),

        setRect: (id, rect) =>
          set((s) => {
            const idx = s.indexById[id];
            if (idx === undefined) return s;
            const curr = s.charts[idx];
            const next = s.charts.slice();
            next[idx] = { ...curr, initial: rect };
            return { charts: next };
          }, false, `charts/setRect/${id}`),

        remove: (id) =>
          set((s) => {
            const idx = s.indexById[id];
            if (idx === undefined) return s;
            const nextCharts = s.charts.slice(0, idx).concat(s.charts.slice(idx + 1));
            // rebuild index map
            const indexById: Record<string, number> = {};
            nextCharts.forEach((c, i) => {
              indexById[c.id] = i;
            });
            return { charts: nextCharts, indexById };
          }, false, `charts/remove/${id}`),

        move: (id, toIndex) =>
          set((s) => {
            const from = s.indexById[id];
            if (from === undefined || toIndex < 0 || toIndex >= s.charts.length) return s;
            if (from === toIndex) return s;
            const arr = s.charts.slice();
            const [item] = arr.splice(from, 1);
            arr.splice(toIndex, 0, item);
            const indexById: Record<string, number> = {};
            arr.forEach((c, i) => {
              indexById[c.id] = i;
            });
            return { charts: arr, indexById };
          }, false, `charts/move/${id}`),
      }),
      {
        name: "charts-store",
        storage: createJSONStorage(() => withFallback(idbStorage)), // ← IndexedDB instead of localStorage
        partialize: (s) => ({ charts: s.charts, indexById: s.indexById }),
        onRehydrateStorage: () => (state) => {
          // mark hydrated after rehydration completes
          if (state) state.hydrated = true;
        },
      }
    )
  )
);
