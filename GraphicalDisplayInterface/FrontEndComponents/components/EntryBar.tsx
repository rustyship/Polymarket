import { useState } from "react";

export default function EntryBar({
  onSubmit,
  placeholder = "Type a query…",
  buttonLabel = "Run",
}: {
  onSubmit: (value: string) => void;
  placeholder?: string;
  buttonLabel?: string;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        gap: 8,
        maxWidth: 700,
        margin: "1rem auto",
        padding: 8,
      }}
      aria-label="entry bar"
    >
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        style={{
          flex: 1,
          padding: "0.6rem 0.8rem",
          border: "1px solid #ccc",
          borderRadius: 8,
          fontSize: 16,
        }}
      />
      <button
        type="submit"
        style={{
          padding: "0.6rem 0.9rem",
          borderRadius: 8,
          border: "1px solid #aaa",
          background: "white",
          cursor: "pointer",
          fontSize: 16,
        }}
      >
        {buttonLabel}
      </button>
    </form>
  );
}