"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useMachine } from "@xstate/react";
import type { ActorRefFrom, SnapshotFrom } from "xstate";
import { machine } from "@/machine/nexus_machine";

type MachineActor = ActorRefFrom<typeof machine>;
type Ctx = SnapshotFrom<typeof machine>["context"];

export type NodeStatus = "active" | "done" | "never";

export type NodeLogEntry = {
  status: NodeStatus;
  context: Ctx | null;
  ts: number | null;
};

export type NodeLog = Record<string, NodeLogEntry>;

type MachineContextValue = {
  state: SnapshotFrom<typeof machine>;
  send: MachineActor["send"];
  nodeLog: NodeLog;
};

const MachineContext = createContext<MachineContextValue | null>(null);

// given a leaf path like "delegator.middleman.robot.robotActor", return
// every prefix along the way too: ["delegator", "delegator.middleman",
// "delegator.middleman.robot", "delegator.middleman.robot.robotActor"]
// — this is purely mechanical string-splitting on whatever XState's
// state.value shape produces, nothing about machine transitions is
// encoded here.
function expandToPrefixes(leafPaths: string[]): Set<string> {
  const all = new Set<string>();
  for (const leaf of leafPaths) {
    const parts = leaf.split(".");
    for (let i = 1; i <= parts.length; i++) {
      all.add(parts.slice(0, i).join("."));
    }
  }
  return all;
}

function flattenStateValue(value: unknown, prefix: string[] = []): string[] {
  if (typeof value === "string") {
    return [[...prefix, value].join(".")];
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, sub]) => flattenStateValue(sub, [...prefix, key]),
    );
  }
  return [prefix.join(".")];
}

export function MachineProvider({ children }: { children: ReactNode }) {
  const [state, send] = useMachine(machine);
  const [nodeLog, setNodeLog] = useState<NodeLog>({});

  useEffect(() => {
    const activeLeaves = flattenStateValue(state.value);
    const activePaths = expandToPrefixes(activeLeaves);

    setNodeLog((prev) => {
      const next: NodeLog = { ...prev };

      // anything active right now: stamp it with the current context
      for (const path of activePaths) {
        next[path] = {
          status: "active",
          context: state.context,
          ts: Date.now(),
        };
      }

      // anything that WAS active but isn't anymore just finished —
      // mark it "done" but keep the context it had at the time it was
      // last active, so you can inspect what it received/produced
      for (const [path, entry] of Object.entries(prev)) {
        if (entry.status === "active" && !activePaths.has(path)) {
          next[path] = { ...entry, status: "done" };
        }
      }

      return next;
    });
  }, [state]);

  return (
    <MachineContext.Provider value={{ state, send, nodeLog }}>
      {children}
    </MachineContext.Provider>
  );
}

export function useNexusMachine() {
  const ctx = useContext(MachineContext);
  if (!ctx) {
    throw new Error("useNexusMachine must be used inside <MachineProvider>");
  }
  return ctx;
}
