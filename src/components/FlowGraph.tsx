"use client";

import { useMemo, useState } from "react";
import { STATE_GRAPH, EDGES, flattenActors } from "./state-graph-data";
import type { NodeLog, NodeLogEntry } from "@/app/context/machine-context";
import type { GraphEdge } from "./state-graph-data";

import { useRouter } from "next/navigation";

type FlowNode = {
  id: string;
  label: string;
  actor?: string;
  x: number;
  y: number;
};

const NODE_W = 100;
const NODE_H = 44;
const H_GAP = 40;
const V_GAP = 60;
const PADDING = 50;

function buildLayout(): { nodes: FlowNode[]; width: number; height: number } {
  const all = flattenActors(STATE_GRAPH);

  const rows: string[][] = [
    ["idle", "orchestrator", "cue", "validateJobActor"],
    ["projectionAgent", "angleAgent", "gearAgent", "polygonAgent"],
    ["agentResult", "sortGroup", "advanceBatch"],
    [
      "director.atomize",
      "director.createActionsTable",
      "nextAction",
      "updateActionPending",
    ],
    [
      "delegator.cameraPosition",
      "delegator.delegate",
      "delegator.validator",
      "delegator.validatorError",
      "delegator.executionError",
    ],
    [
      "tool",
      "toolAppend",
      "cueError",
      "delegator.robotBranch.robotActor",
      "delegator.robotBranch.rosActor",
      "delegator.humanBranch.humanActor",
      "delegator.humanBranch.humanInterpreterActor",
      "delegator.humanBranch.rosActor",
    ],
  ];

  const nodes: FlowNode[] = [];
  const maxCols = Math.max(...rows.map((r) => r.length));

  rows.forEach((row, r) => {
    row.forEach((id, c) => {
      const found = all.find((n) => n.id === id);
      if (found) {
        nodes.push({
          id: found.id,
          label: found.label,
          actor: found.actor,
          x: PADDING + c * (NODE_W + H_GAP),
          y: PADDING + r * (NODE_H + V_GAP),
        });
      }
    });
  });

  return {
    nodes,
    width: PADDING * 2 + maxCols * (NODE_W + H_GAP),
    height: PADDING * 2 + rows.length * (NODE_H + V_GAP),
  };
}

function getStatus(s: "active" | "done" | "never") {
  if (s === "active") return { bg: "#dcfce7", border: "#16a34a", text: "#166534", glow: "0 0 12px rgba(22,163,74,0.4)" };
  if (s === "done") return { bg: "#f1f5f9", border: "#64748b", text: "#334155", glow: "none" };
  return { bg: "#ffffff", border: "#d1d5db", text: "#6b7280", glow: "none" };
}

function ActorOutputModal({
  entry,
  nodeId,
  actor,
  onClose,
}: {
  entry: NodeLogEntry;
  nodeId: string;
  actor?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const hasOutput = entry.output !== undefined;

  const handleTest = () => {
    if (!hasOutput) return;
    const encoded = encodeURIComponent(JSON.stringify(entry.output));
    router.push(`/test?data=${encoded}`);
  };

  const formatOutput = (value: unknown): string => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="actor-output-title"
      style={{ animation: "fadeIn 150ms ease-out" }}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "growIn 180ms ease-out" }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3
              id="actor-output-title"
              className="truncate text-sm font-semibold text-slate-900"
            >
              {nodeId}
            </h3>
            {actor && (
              <p className="mt-0.5 truncate text-[11px] font-medium text-indigo-600">
                {actor}
              </p>
            )}
            <span
              className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                entry.status === "active"
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {entry.status === "active" ? "Running" : "Completed"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleTest}
              disabled={!hasOutput}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:hover:bg-slate-200"
            >
              Test
            </button>
            <button
              onClick={onClose}
              aria-label="Close actor output"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="max-h-[calc(85vh-88px)] overflow-auto p-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Output
          </div>
          {hasOutput ? (
            <pre className="overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-200">
              {formatOutput(entry.output)}
            </pre>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
              No output logged yet for this actor.
            </p>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes growIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Edge flip-card + modal
// ─────────────────────────────────────────────

const KIND_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  default: { bg: "#ffffff", border: "#cbd5e1", text: "#475569" },
  loop: { bg: "#fffbeb", border: "#f59e0b", text: "#92400e" },
  retry: { bg: "#fffbeb", border: "#f59e0b", text: "#92400e" },
  error: { bg: "#fef2f2", border: "#ef4444", text: "#991b1b" },
};

// Turns a context object into readable "Label: value" lines, one level
// deep — good enough for a human skim; the modal's raw-JSON section
// covers anything nested that needs closer inspection.
function humanizeContext(ctx: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  if (!ctx) return [];
  const skip = new Set(["lastError"]);
  const lines: { label: string; value: string }[] = [];

  for (const [key, val] of Object.entries(ctx)) {
    if (val === undefined || skip.has(key)) continue;
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

    let value: string;
    if (val === null) value = "—";
    else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") value = String(val);
    else if (Array.isArray(val)) value = `${val.length} item${val.length === 1 ? "" : "s"}`;
    else value = "(object — see raw JSON)";

    lines.push({ label, value });
  }
  return lines;
}

function EdgeModal({
  edge,
  fromEntry,
  toEntry,
  onClose,
}: {
  edge: GraphEdge;
  fromEntry?: NodeLogEntry;
  toEntry?: NodeLogEntry;
  onClose: () => void;
}) {
  const style = KIND_STYLES[edge.kind ?? "default"];
  const fromLines = humanizeContext(fromEntry?.context as Record<string, unknown> | null);
  const toLines = humanizeContext(toEntry?.context as Record<string, unknown> | null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      style={{ animation: "fadeIn 150ms ease-out" }}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "growIn 180ms ease-out" }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span>{edge.from}</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 4l4 4-4 4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>{edge.to}</span>
            </div>
            {edge.label && (
              <span
                className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
              >
                {edge.label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Before — {edge.from}
            </div>
            {fromLines.length > 0 ? (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs">
                {fromLines.map((l) => (
                  <div key={l.label} className="contents">
                    <dt className="font-medium text-slate-500">{l.label}</dt>
                    <dd className="text-slate-800">{l.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-400">No data logged yet for this node.</p>
            )}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              After — {edge.to}
            </div>
            {toLines.length > 0 ? (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs">
                {toLines.map((l) => (
                  <div key={l.label} className="contents">
                    <dt className="font-medium text-slate-500">{l.label}</dt>
                    <dd className="text-slate-800">{l.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-400">Not reached yet.</p>
            )}
          </div>

          <details className="rounded-lg bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">Raw JSON</summary>
            <pre className="mt-2 overflow-auto rounded bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200">
              {JSON.stringify({ from: fromEntry?.context ?? null, to: toEntry?.context ?? null }, null, 2)}
            </pre>
          </details>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes growIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

function EdgeCard({
  edge,
  x,
  y,
  flipped,
  reached,
  onClick,
}: {
  edge: GraphEdge;
  x: number;
  y: number;
  flipped: boolean;
  reached: boolean;
  onClick: () => void;
}) {
  const style = KIND_STYLES[edge.kind ?? "default"];
  const w = Math.max(48, (edge.label?.length ?? 4) * 5.6 + 16);
  const h = 20;

  return (
    <foreignObject x={x - w / 2} y={y - h / 2} width={w} height={h} style={{ overflow: "visible" }}>
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (reached) onClick();
        }}
        style={{
          width: w,
          height: h,
          perspective: "300px",
          cursor: reached ? "pointer" : "default",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
            transition: "transform 220ms ease",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* front */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: style.bg,
              border: `1px solid ${style.border}`,
              fontSize: 7,
              fontWeight: 500,
              color: style.text,
              boxShadow: reached ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              opacity: reached ? 1 : 0.5,
            }}
          >
            {edge.label}
          </div>
          {/* back */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: style.border,
              color: "#fff",
              fontSize: 7,
              fontWeight: 600,
            }}
          >
            View →
          </div>
        </div>
      </div>
    </foreignObject>
  );
}

export function FlowGraph({ nodeLog }: { nodeLog: NodeLog }) {
  const { nodes, width, height } = useMemo(() => buildLayout(), []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [flippedEdgeId, setFlippedEdgeId] = useState<string | null>(null);
  const [modalEdgeId, setModalEdgeId] = useState<string | null>(null);

  const nodeMap = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const selectedEntry = selectedNode ? nodeLog[selectedNode] : undefined;
  const modalEdge = modalEdgeId ? EDGES.find((e) => e.id === modalEdgeId) : undefined;

  const handleEdgeClick = (edgeId: string) => {
    if (flippedEdgeId === edgeId) {
      setModalEdgeId(edgeId);
    } else {
      setFlippedEdgeId(edgeId);
    }
  };

  const closeModal = () => {
    setModalEdgeId(null);
    setFlippedEdgeId(null);
  };

  const renderEdges = () =>
    EDGES.map((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return null;

      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      const path =
        Math.abs(y2 - y1) < 5
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;

      const color = KIND_STYLES[edge.kind ?? "default"].border;
      // "reached" = the from-node has actually logged something, i.e.
      // this transition has plausibly fired at least once — cards for
      // edges that never ran stay dim and non-interactive.
      const reached = Boolean(nodeLog[edge.from]);

      return (
        <g key={edge.id}>
          <path d={path} fill="none" stroke={reached ? color : "#e2e8f0"} strokeWidth={1.5} markerEnd="url(#arrow)" />
          {edge.label && (
            <EdgeCard
              edge={edge}
              x={mx}
              y={my}
              flipped={flippedEdgeId === edge.id}
              reached={reached}
              onClick={() => handleEdgeClick(edge.id)}
            />
          )}
        </g>
      );
    });

  const renderNodes = () =>
    nodes.map((node) => {
      const entry = nodeLog[node.id];
      const status = entry?.status ?? "never";
      const s = getStatus(status);

      return (
        <g
          key={node.id}
          onClick={() => entry && setSelectedNode(node.id)}
          onKeyDown={(event) => {
            if (
              entry &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              setSelectedNode(node.id);
            }
          }}
          role={entry ? "button" : undefined}
          tabIndex={entry ? 0 : -1}
          style={{ cursor: entry ? "pointer" : "default" }}
        >
          <rect
            x={node.x}
            y={node.y}
            width={NODE_W}
            height={NODE_H}
            rx={8}
            fill={s.bg}
            stroke={s.border}
            strokeWidth={selectedNode === node.id ? 2.5 : 1.5}
            style={{ boxShadow: s.glow }}
          />

          {status === "active" && (
            <rect
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill="none"
              stroke="#16a34a"
              strokeWidth={2}
              opacity={0.6}
            >
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
            </rect>
          )}

          <text x={node.x + NODE_W / 2} y={node.y + 18} textAnchor="middle" fontSize={11} fontWeight={600} fill={s.text}>
            {node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label}
          </text>

          {node.actor && (
            <text x={node.x + NODE_W / 2} y={node.y + 33} textAnchor="middle" fontSize={8} fill="#8b5cf6" fontFamily="ui-monospace, monospace">
              {node.actor.length > 18 ? node.actor.slice(0, 18) + "…" : node.actor}
            </text>
          )}

          {status !== "never" && (
            <circle
              cx={node.x + NODE_W - 8}
              cy={node.y + 8}
              r={5}
              fill={status === "active" ? "#16a34a" : "#64748b"}
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </g>
      );
    });

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-slate-200 bg-[#fafbfc]">
      <div className="flex-1 overflow-auto">
        <svg width={width} height={height} style={{ display: "block", minWidth: "100%" }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={6} markerHeight={6} orient="auto">
              <path d="M0 0L10 5L0 10z" fill="#94a3b8" />
            </marker>
          </defs>
          <rect width={width} height={height} fill="#fafbfc" />
          {renderEdges()}
          {renderNodes()}
        </svg>
      </div>

      {selectedNode && selectedEntry && (
        <ActorOutputModal
          entry={selectedEntry}
          nodeId={selectedNode}
          actor={nodeMap.get(selectedNode)?.actor}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {modalEdge && (
        <EdgeModal
          edge={modalEdge}
          fromEntry={nodeLog[modalEdge.from]}
          toEntry={nodeLog[modalEdge.to]}
          onClose={closeModal}
        />
      )}
    </div>
  );
}