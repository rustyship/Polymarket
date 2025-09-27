import React from "react";

import type { HitrInput } from "./types";

type Props = {
  data: HitrInput; // [[market names], [hit rates in percent]]
};

export function HitrTable({ data }: Props) {
  const [names, vals] = data;

  // parse + validate
  const rows = names.map((name, i) => {
    const raw = vals[i];
    const n = typeof raw === "string" ? parseFloat(raw) : raw;
    const val = Number.isFinite(n as number) ? (n as number) : undefined; // already percent
    return { name, val };
  });

  const fmtCell = (v: number | undefined) =>
    Number.isFinite(v as number) ? `${(v as number).toFixed(10)}%` : "—";

  const copyCSV = async () => {
    const header = "name,hit_rate_%";
    const lines = rows.map((r) =>
      `${r.name},${Number.isFinite(r.val as number) ? (r.val as number).toFixed(10) : ""}`
    );
    const csv = [header, ...lines].join("\n");

    try {
      await navigator.clipboard.writeText(csv);
      // optional: toast here if you have one
    } catch {
      // Fallback for environments without Clipboard API
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

  return (
    <div style={{ width: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 6px" }}>
              Market
            </th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #ccc", padding: "4px 6px" }}>
              Hit Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, val }) => (
            <tr key={name}>
              <td style={{ padding: "4px 6px" }}>{name}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmtCell(val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
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
