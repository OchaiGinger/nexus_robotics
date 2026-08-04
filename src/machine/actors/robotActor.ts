import { fromPromise } from "xstate";

import type { ActionPair } from "./types";

type RobotActorInput = {
  job: { id: string; payload: unknown };
  actionsResult?: {
    label: "done";
    jobId: string;
    pair: ActionPair;
  };
};
type RobotActorInput = {
  job: { id: string; payload: unknown };
  actionsResult?: {
    label: "done";
    jobId: string;
    pair: {
      atomType: string;
      toolLocation?: {
        tool: string;
        x: number;
        y: number;
        distanceMeters: number;
      };
    };
  };
};

type RobotActorOutput = {
  label: "done";
  jobId: string;
  robotPlan: {
    action: string;
    target: { x: number; y: number; z: number };
  };
};

// ASSUMED verbs — pick* is CONFIRMED behavior (you described it
// directly: "pick a pencil at location..."). mark*/calibrate verbs are
// my inference, not confirmed.
const ATOM_ACTION: Record<string, string> = {
  pickPencil: "pick",
  pickRuler: "pick",
  calibrate: "calibrate",
  markPointX: "mark",
  markPointY: "mark",
};

export const robotActor = fromPromise<RobotActorOutput, RobotActorInput>(
  async ({ input }) => {
    const { job, actionsResult } = input;
    if (!job) throw new Error("robotActor requires a job");

    const pair = actionsResult?.pair;
    if (!pair?.atomType) {
      throw new Error("robotActor requires actionsResult.pair.atomType");
    }

    if (!pair.toolLocation) {
      // See flagged gap: cameraPositionActor currently only detects
      // physical tools (pick* atoms). Atoms like markPointX/calibrate
      // have no toolLocation yet — this will throw until that's solved.
      throw new Error(
        `robotActor: no toolLocation on pair for atomType "${pair.atomType}" — cameraPositionActor doesn't yet know how to locate non-tool targets`,
      );
    }

    const action = ATOM_ACTION[pair.atomType] ?? pair.atomType;

    const robotPlan = {
      action,
      target: {
        x: pair.toolLocation.x,
        y: pair.toolLocation.y,
        z: pair.toolLocation.distanceMeters,
      },
    };

    return { label: "done", jobId: job.id, robotPlan };
  },
);
