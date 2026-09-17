"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useMachine } from "@xstate/react";
import type {
  ActorRefFrom,
  InspectionEvent,
  SnapshotFrom,
} from "xstate";
import { machine } from "@/machine/nexus_machine";

type MachineActor = ActorRefFrom<typeof machine>;
type Ctx = SnapshotFrom<typeof machine>["context"];

export type NodeStatus = "active" | "done" | "never";

export type NodeLogEntry = {
  status: NodeStatus;
  context: Ctx | null;
  output?: unknown;
  ts: number | null;
};

export type NodeLog = Record<string, NodeLogEntry>;

const ACTOR_OUTPUT_NODES: Record<string, string> = {
  Ochestrator: "orchestrator",
  QueueActor: "cue",
  ToolSmithActor: "tool",
  ValidateJobActor: "validateJobActor",
  ToolAppendActor: "toolAppend",
  AtomizerActor: "director.atomize",
  CreateActionsTableActor: "director.createActionsTable",
  NextActionActor: "nextAction",
  UpdateActionPending: "updateActionPending",
  UpdateActionCompleted: "updateActionCompleted",
  CameraPositionActor: "delegator.cameraPosition",
  DelegatorActor: "delegator.delegate",
  RobotActor: "delegator.robotBranch.robotActor",
  RobotRosActor: "delegator.robotBranch.rosActor",
  HumanActor: "delegator.humanBranch.humanActor",
  HumanInterpreterActor:
    "delegator.humanBranch.humanInterpreterActor",
  HumanRosActor: "delegator.humanBranch.rosActor",
  RobotActorBoth:
    "delegator.bothBranch.robotRegion.robotActor",
  RobotRosActorBoth:
    "delegator.bothBranch.robotRegion.rosActor",
  ValidateRobotOnly:
    "delegator.bothBranch.robotRegion.validate",
  HumanActorBoth:
    "delegator.bothBranch.humanRegion.humanActor",
  HumanInterpreterActorBoth:
    "delegator.bothBranch.humanRegion.humanInterpreterActor",
  HumanRosActorBoth:
    "delegator.bothBranch.humanRegion.rosActor",
  ValidateHumanOnly:
    "delegator.bothBranch.humanRegion.validate",
  ValidatorActor: "delegator.validator",
  UpdatePendWaitingActor: "advanceBatch",
  ProjectionActor: "projectionAgent",
  AngleActor: "angleAgent",
  GearActor: "gearAgent",
  PolygonActor: "polygonAgent",
  createWaitingPendingActor: "agentResult",
  SortGroupActor: "sortGroup",
};

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
  const [nodeLog, setNodeLog] = useState<NodeLog>({});
  const [state, send] = useMachine(machine, {
    inspect: (inspectionEvent: InspectionEvent) => {
      if (inspectionEvent.type === "@xstate.snapshot") {
        const snapshot = inspectionEvent.snapshot;
        if (!("context" in snapshot)) return;

        const machineSnapshot = snapshot as {
          value: unknown;
          context: unknown;
        };
        const activePaths = expandToPrefixes(
          flattenStateValue(machineSnapshot.value),
        );
        const context = machineSnapshot.context as Ctx;

        setNodeLog((prev) => {
          const next: NodeLog = { ...prev };

          for (const path of activePaths) {
            next[path] = {
              ...next[path],
              status: "active",
              context,
              ts: Date.now(),
            };
          }

          for (const [path, entry] of Object.entries(prev)) {
            if (entry.status === "active" && !activePaths.has(path)) {
              next[path] = { ...entry, status: "done" };
            }
          }

          return next;
        });
        return;
      }

      if (
        inspectionEvent.type !== "@xstate.event" ||
        !inspectionEvent.event.type.startsWith("xstate.done.actor.")
      ) {
        return;
      }

      const actorId = inspectionEvent.event.type.slice(
        "xstate.done.actor.".length,
      );
      const nodeId = ACTOR_OUTPUT_NODES[actorId];
      if (!nodeId) return;

      const output = (
        inspectionEvent.event as { output?: unknown }
      ).output;

      setNodeLog((prev) => {
        const previous = prev[nodeId];
        return {
          ...prev,
          [nodeId]: {
            status: previous?.status === "active" ? "active" : "done",
            context: previous?.context ?? null,
            output,
            ts: Date.now(),
          },
        };
      });
    },
  });

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
