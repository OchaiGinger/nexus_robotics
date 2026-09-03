"use client";

import { useMemo, useState } from "react";
import { STATE_GRAPH, EDGES, flattenActors } from "./state-graph-data";
import type { NodeLog, NodeLogEntry } from "@/app/context/machine-context";

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
      "delegator.cameraPosition",
      "delegator.delegate",
      "delegator.validator",
      "delegator.updateActionsTable",
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

function PayloadPanel({ entry, nodeId, onClose }: { entry: NodeLogEntry; nodeId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"context" | "raw">("context");
  const router = useRouter();
  const ctx = entry.context as Record<string, unknown> | null;
  const input = ctx?.job ?? ctx?.actionsResult ?? ctx?.toolResult;
  // Agent output is wrapped as { label, jobId, agent, result } in the
  // machine context. The angle-specific fields live in `result`.
  const agentResult = ctx?.agentResult as { result?: unknown } | undefined;
  const output = (agentResult?.result ?? ctx?.validationResult ?? ctx?.actionsResult) as Record<string, unknown> | undefined;
  const lastError = ctx?.lastError;
  const decomp = output?.decomp as { full: (number | string)[]; gap: (number | string)[] } | undefined;
  const quadrant = output?.quadrant as number | undefined;
  const gap = output?.gap as number | undefined;
  const from = output?.from as string | undefined;
  const steps = output?.steps as Record<string, unknown>[] | undefined;

  // Context payloads are intentionally `unknown` because they come from
  // different actors. Never render one directly in JSX; convert it to a
  // concrete string at the UI boundary.
  const displayText = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value == null) return "";
    return JSON.stringify(value) ?? String(value);
  };

  const handleTest = () => {
    const testData = output || ctx || {};
    const encoded = encodeURIComponent(JSON.stringify(testData, null, 2));
    router.push(`/test?data=${encoded}`);
  };

  const formatDecompItem = (item: number | string): string =>
    typeof item === "string" ? `compass ${item.slice(1)}°` : `${item}°`;

  const isCompass = (item: number | string): boolean => typeof item === "string";

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{nodeId}</h3>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${entry.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
            {entry.status === "active" ? "Running" : "Completed"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Test
          </button>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-100 px-4">
        {(["context", "raw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${tab === t ? "border-b-2 border-indigo-500 text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === "context" && (
          <div className="space-y-4">
            {decomp?.full && decomp.full.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Full Decomposition</div>
                <div className="flex flex-wrap gap-1.5">
                  {decomp.full.map((part, i) => (
                    <span
                      key={i}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                        isCompass(part) ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {formatDecompItem(part)}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-3 text-[10px] text-slate-500">
                  <span>{decomp.full.reduce<number>((sum, p) => sum + (typeof p === "number" ? p : parseFloat(p.slice(1))), 0)}° total</span>
                  {quadrant && <span>Q{quadrant}</span>}
                </div>
              </div>
            )}
            {decomp?.gap && decomp.gap.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gap Decomposition ({gap}° from {from})</div>
                <div className="flex flex-wrap gap-1.5">
                  {decomp.gap.map((part, i) => (
                    <span
                      key={i}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                        isCompass(part) ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {formatDecompItem(part)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {steps && steps.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Steps ({steps.length})</div>
                <div className="space-y-1">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-[9px]">
                      <span className="font-medium text-slate-500">{i + 1}</span>
                      <span className={`rounded px-1 py-0.5 font-medium ${
                        step.t === "baseline" ? "bg-blue-100 text-blue-700"
                          : step.t === "arc" ? "bg-purple-100 text-purple-700"
                          : step.t === "mark" ? "bg-green-100 text-green-700"
                          : step.t === "bisect" ? "bg-orange-100 text-orange-700"
                          : step.t === "compass" ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {displayText(step.t)}
                      </span>
                      <span className="text-slate-600">{displayText(step.l)}</span>
                      {step.pin != null && <span className="text-slate-400">@{displayText(step.pin)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Boolean(input) && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Input</div>
                <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-300">
                  {displayText(input)}
                </pre>
              </div>
            )}
            {output && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Output</div>
                <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-blue-300">
                  {displayText(output)}
                </pre>
              </div>
            )}
            {Boolean(lastError) && (
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-500">Last Error</div>
                <pre className="overflow-auto rounded-lg bg-red-950 p-3 text-[11px] leading-relaxed text-red-100">
                  {lastError instanceof Error ? lastError.message : displayText(lastError)}
                </pre>
              </div>
            )}
            {!input && !output && (
              <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-300">
                {displayText(ctx)}
              </pre>
            )}
          </div>
        )}
        {tab === "raw" && (
          <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-300">
            {displayText(entry.context)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function FlowGraph({ nodeLog }: { nodeLog: NodeLog }) {
  const { nodes, width, height } = useMemo(() => buildLayout(), []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const nodeMap = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const selectedEntry = selectedNode ? nodeLog[selectedNode] : undefined;

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

      const color =
        edge.kind === "error" ? "#ef4444" : edge.kind === "loop" || edge.kind === "retry" ? "#f59e0b" : "#cbd5e1";

      return (
        <g key={edge.id}>
          <path d={path} fill="none" stroke={color} strokeWidth={1.5} markerEnd="url(#arrow)" />
          {edge.label && (
            <g>
              <rect
                x={mx - edge.label.length * 2.8}
                y={my - 7}
                width={edge.label.length * 5.6 + 8}
                height={14}
                rx={4}
                fill="#fff"
                stroke="#e2e8f0"
                strokeWidth={0.5}
              />
              <text x={mx + 4} y={my + 3} textAnchor="middle" fontSize={7} fill="#64748b" fontWeight={500}>
                {edge.label}
              </text>
            </g>
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
        <div className="w-[380px] flex-shrink-0">
          <PayloadPanel entry={selectedEntry} nodeId={selectedNode} onClose={() => setSelectedNode(null)} />
        </div>
      )}
    </div>
  );
}
