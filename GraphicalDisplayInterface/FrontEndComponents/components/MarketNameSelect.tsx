import { useEffect, useState, type CSSProperties } from "react";

export type NameIdPair = {
  marketName: string;
  marketID: string;
};

type MarketNameSelectProps = {
  /** Controlled value: selected marketId */
  value?: string;
  /** Emits the selected NameIdPair */
  onChange?: (pair: NameIdPair) => void;
  /** Endpoint returning NameIdPair[] */
  apiUrl?: string; // defaults to /markets/names
  className?: string;
  disabled?: boolean;
  style?: CSSProperties;          // applied to <select>
  containerStyle?: CSSProperties; // applied to wrapper <div>
};

export default function MarketNameSelect({
  value,
  onChange,
  apiUrl = "/markets/names",
  className,
  disabled = false,
  style,
  containerStyle,
}: MarketNameSelectProps) {
  const [options, setOptions] = useState<NameIdPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        if (!cancelled) setOptions(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load markets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  // If parent doesn't provide a value, show the first option when available.
  const selectedId = value ?? (options.length ? options[0].marketID : "");

  const isDisabled = disabled || loading || !!error;

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
    </div>
  );
}