import { useState } from "react";

import { Icon } from "@/components/operator-ui";
import { Input } from "@/components/ui/input";

import { abbreviateViews, formatViewCount } from "./types";

// Generic "type a value and add as a pill" input. Used for search themes and times.
export function PillListInput({
  values,
  onChange,
  placeholder,
  normalize,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  // Return the normalized value to add, or null to reject the input.
  normalize: (raw: string) => string | null;
}) {
  const [text, setText] = useState("");

  function add() {
    const normalized = normalize(text);
    if (!normalized) return;
    if (!values.includes(normalized)) onChange([...values, normalized]);
    setText("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="flex gap-2">
        <Input
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          value={text}
        />
        <button className="tab" onClick={add} type="button" style={{ flexShrink: 0 }}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              className="flex items-center gap-1"
              key={value}
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 6px 3px 10px",
                fontSize: 12,
              }}
            >
              {value}
              <button onClick={() => remove(value)} type="button" style={{ display: "flex", color: "var(--text-muted)" }}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Masked number input that groups digits as you type (1.000.000) and shows an
// abbreviation hint ("≈ 1 mi").
export function ViewCountInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <Input
        inputMode="numeric"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? Number(digits) : 0);
        }}
        placeholder="0 = qualquer"
        value={formatViewCount(value)}
      />
      <span className="text-xs muted">≈ {abbreviateViews(value)} views mínimas</span>
    </div>
  );
}

// Normalize "HH:mm" time input. Accepts "9", "9:5", "09:00" → "09:00".
export function normalizeTime(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeQuery(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return cleaned.length >= 2 ? cleaned : null;
}
