// src/machine/actors/robotActor.ts
import { fromPromise } from "xstate";

import type { ActionPair, PairAtom } from "./types";

type RobotActorInput = {
  job: { id: string; payload: unknown };
  actionsResult?: {
    label: "done";
    jobId: string;
    pair: ActionPair;
  };
};

function atomForRole(pair: ActionPair, role: "robot" | "human"): PairAtom | undefined {
  return pair.find((atom) => atom.actor === role);
}

type RobotPlan =
  | { action: "pick"; tool: string } // robot does its own continuous YOLO-guided approach
  | { action: string; target: { x: number; y: number } }
  | { action: "draw"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { action: "drawArc"; center: { x: number; y: number }; radius: number; angle: number }
  | { action: string };

type RobotActorOutput = {
  label: "done";
  jobId: string;
  robotPlan: RobotPlan;
};

const PICK_ATOMS = new Set(["pickPencil", "pickRuler", "pickCompass"]);

const ATOM_ACTION: Record<string, string> = {
  pickPencil: "pick",
  pickRuler: "pick",
  pickCompass: "pick",
  markPointX: "mark",
  markPointY: "mark",
  drawLine: "draw",
  drawArc: "drawArc",
  collect: "collect",
};

export const robotActor = fromPromise<RobotActorOutput, RobotActorInput>(
  async ({ input }) => {
    const { job, actionsResult } = input;
    if (!job) throw new Error("robotActor requires a job");

    const pair = actionsResult ? atomForRole(actionsResult.pair, "robot") : undefined;
    if (!pair?.atomType) {
      throw new Error("robotActor requires a robot atom in actionsResult.pair");
    }

    const action = ATOM_ACTION[pair.atomType] ?? pair.atomType;

    if (PICK_ATOMS.has(pair.atomType)) {
      // No vision pre-resolution — the robot's own ROS-side node does
      // continuous YOLO-guided servoing until it acquires the tool.
      // Only the tool name is sent.
      const tool = pair.atomType.replace(/^pick/, "").toLowerCase();
      return { label: "done", jobId: job.id, robotPlan: { action: "pick", tool } };
    }

    const values = pair.values as
      | { point?: [number, number] }
      | { from?: [number, number]; to?: [number, number] }
      | { center?: [number, number]; radius?: number; angle?: number }
      | undefined;

    if (!values) {
      return { label: "done", jobId: job.id, robotPlan: { action } };
    }

    if ("point" in values && values.point) {
      return {
        label: "done",
        jobId: job.id,
        robotPlan: { action, target: { x: values.point[0], y: values.point[1] } },
      };
    }

    if ("from" in values && values.from && "to" in values && values.to) {
      return {
        label: "done",
        jobId: job.id,
        robotPlan: {
          action: "draw",
          from: { x: values.from[0], y: values.from[1] },
          to: { x: values.to[0], y: values.to[1] },
        },
      };
    }

    if ("center" in values && values.center && typeof values.radius === "number") {
      return {
        label: "done",
        jobId: job.id,
        robotPlan: {
          action: "drawArc",
          center: { x: values.center[0], y: values.center[1] },
          radius: values.radius,
          angle: values.angle ?? 0,
        },
      };
    }

    throw new Error(
      `robotActor: unrecognized values shape for atomType "${pair.atomType}": ${JSON.stringify(values)}`,
    );
  },
);