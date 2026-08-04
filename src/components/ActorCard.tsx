"use client";

import type { NodeLog } from "@/app/context/machine-context";

const STATUS_STYLES = {
  active: { border: "#16a34a", bg: "#dcfce7", dot: "#16a34a" },
  done: { border: "#94a3b8", bg: "#f1f5f9", dot: "#64748b" },
  never: { border: "#e5e7eb", bg: "#fff", dot: null },
} as const;

export function ActorCard({
  id,
  label,
  actor,
  nodeLog,
}: {
  id: string;
  label: string;
  actor: string;
  nodeLog: NodeLog;
}) {
  const entry = nodeLog[id];
  const status = entry?.status ?? "never";
  const style = STATUS_STYLES[status];

  return (
    <div
      style={{
        border: "2px solid",
        borderColor: style.border,
        background: style.bg,
        borderRadius: 10,
        padding: 10,
        minWidth: 180,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {style.dot && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: style.dot,
              flexShrink: 0,
            }}
          />
        )}
        {label}
        {status !== "never" && (
          <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 400 }}>
            {status === "active" ? "(running)" : "(done)"}
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          color: "#7c3aed",
          fontFamily: "monospace",
          marginTop: 2,
        }}
      >
        {actor}
      </div>

      {entry && (
        <details style={{ marginTop: 6 }}>
          <summary
            style={{ fontSize: 10, color: "#6b7280", cursor: "pointer" }}
          >
            payload
          </summary>
          <pre
            style={{
              fontSize: 10,
              marginTop: 4,
              background: "#0b1020",
              color: "#d1e7ff",
              padding: 6,
              borderRadius: 4,
              maxWidth: 260,
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {JSON.stringify(entry.context, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
