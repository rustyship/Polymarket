// /mnt/data/RSquaredTable.tsx

// Strict reshape: throws if `flat.length !== n*n`.
function reshapeFlatR2(flat: number[], n: number): number[][] {
  if (!Number.isInteger(n) || n <= 0 || flat.length !== n * n) {
    throw new Error(`r² length ${flat.length} != n*n (${n}²)`);
  }
  return Array.from({ length: n }, (_, i) => flat.slice(i * n, (i + 1) * n));
}

type Props = {
  flat: number[];     // flattened n*n r^2 matrix, row-major
  labels: string[];   // length n
};

export function R2Table({ flat, labels }: Props) {
  let z: number[][] = [];
  let err: string | null = null;

  try {
    z = reshapeFlatR2(flat, labels.length);
  } catch (e: any) {
    err = e?.message || "Invalid r² payload";
  }

  const DECIMALS = 10;

  const fmtCell = (v: number | undefined) =>
    Number.isFinite(v as number) ? (v as number).toFixed(DECIMALS) : "—";

  const copyCSV = async () => {
    if (!z.length) return;

    const header = ["", ...labels].join(",");
    const lines = z.map((row, i) =>
      [labels[i], ...row.map(v => (Number.isFinite(v) ? v.toFixed(DECIMALS) : ""))].join(",")
    );
    const csv = [header, ...lines].join("\n");

    try {
      await navigator.clipboard.writeText(csv);
    } catch {
      // Fallback when Clipboard API is unavailable
      const el = document.createElement("textarea");
      el.value = csv;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(el);
      }
    }
  };

  if (err) {
    return <div style={{ color: "#b00", fontFamily: "monospace" }}>{err}</div>;
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 6px" }}>
                {/* empty corner cell */}
              </th>
              {labels.map((lab) => (
                <th
                  key={lab}
                  style={{ textAlign: "right", borderBottom: "1px solid #ccc", padding: "4px 6px" }}
                >
                  {lab}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {z.map((row, i) => (
              <tr key={labels[i]}>
                <td style={{ padding: "4px 6px" }}>{labels[i]}</td>
                {row.map((v, j) => (
                  <td key={j} style={{ padding: "4px 6px", textAlign: "right" }}>
                    {fmtCell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6, marginTop: 6 }}>
        <button
          type="button"
          onClick={copyCSV}
          style={{
            padding: "4px 8px",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Copy CSV
        </button>
      </div>
    </div>
  );
}
