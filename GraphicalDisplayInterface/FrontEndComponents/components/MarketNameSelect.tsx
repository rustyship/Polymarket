import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NameIdPair } from "./types";

type MarketNameSelectProps = {
  /** Controlled value: selected marketID */
  value?: string;
  /** Emits the selected NameIdPair */
  onChange?: (pair: NameIdPair) => void;

  /** Preferred source of options: preloaded list */
  marketNameIds?: NameIdPair[];

  /** Fallback endpoint if list not supplied */
  apiUrl?: string; // defaults to /markets/names

  className?: string;
  disabled?: boolean;
  style?: CSSProperties;          // applied to <select>
  containerStyle?: CSSProperties; // applied to wrapper <div>
};

export default function MarketNameSelect({
  value,
  onChange,
  marketNameIds,
  apiUrl = "/markets/names",
  className,
  disabled = false,
  style,
  containerStyle,
}: MarketNameSelectProps) {
  // Local state only needed if we must fetch as a fallback.
  const [fetched, setFetched] = useState<NameIdPair[] | null>(null);
  const [loading, setLoading] = useState<boolean>(!marketNameIds || marketNameIds.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Fetch only if we don't have a supplied list.
  useEffect(() => {
    const shouldFetch = !marketNameIds || marketNameIds.length === 0;
    if (!shouldFetch) {
      setLoading(false);
      setError(null);
      setFetched(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(apiUrl, { method: "GET" });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Request failed ${res.status}`);
        }
        const data = (await res.json()) as NameIdPair[];
        if (!cancelled) setFetched(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load markets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [apiUrl, marketNameIds]);

  // Effective options come from props first, otherwise fetched fallback.
  const options: NameIdPair[] = useMemo(() => {
    if (marketNameIds && marketNameIds.length > 0) return marketNameIds;
    return fetched ?? [];
  }, [marketNameIds, fetched]);

  // Auto-select first option when value is empty.
  useEffect(() => {
    const noControlled = value == null || value === "";
    if (!loading && !error && noControlled && options.length > 0) {
      onChange?.(options[0]);
    }
  }, [loading, error, options, value, onChange]);

  // If parent doesn't provide a value, show the first option when available.
  const selectedId = value ?? (options.length ? options[0].marketID : "");
  const isDisabled = disabled || loading || !!error || options.length === 0;

  return (
    <div className={className} style={containerStyle}>
      <select
        style={style}
        value={selectedId}
        onChange={(e) => {
          const id = e.target.value;
          const pair = options.find((o) => o.marketID === id);
          if (pair) onChange?.(pair);
        }}
        disabled={isDisabled}
      >
        {options.map((o) => (
          <option key={o.marketID} value={o.marketID}>
            {o.marketName}
          </option>
        ))}
      </select>

      {loading && <div style={{ fontSize: 12, color: "#667" }}>loading…</div>}
      {!loading && error && (
        <div style={{ fontSize: 12, color: "#b00", marginTop: 6 }}>{error}</div>
      )}
      {!loading && !error && options.length === 0 && (
        <div style={{ fontSize: 12, color: "#667", marginTop: 6 }}>
          no markets available
        </div>
      )}
    </div>
  );
}
