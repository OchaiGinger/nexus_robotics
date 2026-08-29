"use client";

import { useState } from "react";
import type { NodeLog } from "@/app/context/machine-context";

const STATUS_COLORS = {
  active: { fill: "#dcfce7", stroke: "#16a34a", dot: "#16a34a" },
  done: { fill: "#f1f5f9", stroke: "#94a3b8", dot: "#64748b" },
  never: { fill: "#ffffff", stroke: "#d1d5db", dot: null },
} as const;

const NODE_RADIUS = 28;

export function NodeCard({
  id,
  label,
  actor,
  nodeLog,
  compact = false,
}: {
  id: string;
  label: string;
  actor?: string;
  nodeLog: NodeLog;
  compact?: boolean;
}) {
  const entry = nodeLog[id];
  const status = entry?.status ?? "never";
  const colors = STATUS_COLORS[status];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="flex flex-col items-center"
      style={{ width: compact ? 90 : 100 }}
    >
      <svg width={NODE_RADIUS * 2 + 4} height={NODE_RADIUS * 2 + 4}>
        <circle
          cx={NODE_RADIUS + 2}
          cy={NODE_RADIUS + 2}
          r={NODE_RADIUS}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
          style={{
            filter:
              status === "active"
                ? "drop-shadow(0 0 4px rgba(22, 163, 74, 0.5))"
                : "none",
          }}
        />
        <text
          x={NODE_RADIUS + 2}
          y={NODE_RADIUS - 2}
          textAnchor="middle"
          fontSize={8}
          fontWeight={600}
          fill="#1f2937"
        >
          {label.length > 9 ? label.slice(0, 9) + "…" : label}
        </text>
        {actor && (
          <text
            x={NODE_RADIUS + 2}
            y={NODE_RADIUS + 10}
            textAnchor="middle"
            fontSize={6}
            fill="#7c3aed"
            fontFamily="monospace"
          >
            {actor.length > 13 ? actor.slice(0, 13) + "…" : actor}
          </text>
        )}
        {colors.dot && (
          <circle
            cx={NODE_RADIUS * 2 - 4}
            cy={6}
            r={4}
            fill={colors.dot}
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}
      </svg>

      {entry && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium transition-colors hover:bg-muted/50"
          style={{
            color: status === "active" ? "#16a34a" : "#64748b",
          }}
        >
          <span
            className="inline-block transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
          {status === "active" ? "running" : "done"}
        </button>
      )}

      {expanded && entry && (
        <div
          className="mt-1 w-full overflow-auto rounded border border-border bg-[#0b1020] p-1.5"
          style={{
            maxHeight: 150,
            fontSize: 8,
            lineHeight: 1.3,
            fontFamily: "monospace",
          }}
        >
          <pre className="whitespace-pre-wrap break-words text-blue-200">
            {JSON.stringify(entry.context, null, 1)}
          </pre>
        </div>
      )}
    </div>
  );
}
