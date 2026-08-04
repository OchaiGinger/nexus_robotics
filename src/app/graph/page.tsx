"use client";

import Link from "next/link";
import { useNexusMachine } from "@/app/context/machine-context";
import { STATE_GRAPH } from "../../components/state-graph-data";
import { GraphView } from "../../components/GraphView";
import { flattenActors } from "../../components/flatten-actors";
import { NodeCard } from "../../components/NodeCard";

export default function GraphPage() {
  const { state, nodeLog } = useNexusMachine();
  const allActors = flattenActors(STATE_GRAPH);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h1>Nexus state graph</h1>
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        Current: <code>{JSON.stringify(state.value)}</code>
      </p>

      <h2 style={{ marginTop: 24, fontSize: 16 }}>State graph</h2>
      <GraphView nodeLog={nodeLog} />

      <h2 style={{ marginTop: 40, fontSize: 16 }}>
        All actors ({allActors.length})
      </h2>
      <p style={{ color: "#6b7280", fontSize: 12, marginTop: -4 }}>
        Every actor registered in the machine, flattened regardless of nesting.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 12,
        }}
      >
        {allActors.map((a) => (
          <NodeCard
            key={a.id}
            id={a.id}
            label={a.label}
            actor={a.actor}
            nodeLog={nodeLog}
            compact
          />
        ))}
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/">← Back to jobs</Link>
      </p>
    </div>
  );
}
