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
  | { action: string; target: { x: number; y: number; z: number } } // pick — vision-located
  | { action: string; target: { x: number; y: number } } // mark — construction-space point
  | { action: "draw"; from: { x: number; y: number }; to: { x: number; y: number } } // line
  | { action: "drawArc"; center: { x: number; y: number }; radius: number; angle: number }
  | { action: string }; // no-target actions (e.g. collect)

type RobotActorOutput = {
  label: "done";
  jobId: string;
  robotPlan: RobotPlan;
};

// CONFIRMED: pick* atoms require vision-detected toolLocation (you
// described this directly). Everything else below is ASSUMED based on
// the values shapes atomizerActor's Slot definitions produce for
// baseline/arc — not yet confirmed against real construction data.
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
      if (!pair.toolLocation) {
        throw new Error(
          `robotActor: no toolLocation on pair for atomType "${pair.atomType}" — cameraPositionActor must run before this atom is dispatched`,
        );
      }
      return {
        label: "done",
        jobId: job.id,
        robotPlan: {
          action,
          target: {
            x: pair.toolLocation.x,
            y: pair.toolLocation.y,
            z: pair.toolLocation.distanceMeters,
          },
        },
      };
    }

    // Construction-space atoms already carry their real coordinates
    // from atomizerActor's Slot.values extractor — no vision needed.
    const values = pair.values as
      | { point?: [number, number] }
      | { from?: [number, number]; to?: [number, number] }
      | { center?: [number, number]; radius?: number; angle?: number }
      | undefined;

    if (!values) {
      // e.g. "collect" — no target coordinates required
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