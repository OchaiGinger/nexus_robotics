// src/machine/actors/humanActor.ts
import { fromPromise } from "xstate";

import type { ActionPair, PairAtom } from "./types";

type HumanActorInput = {
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

type HumanActorOutput = {
  label: "done";
  jobId: string;
  humanInstructions: { text: string; atomType: string };
};

const PICK_ATOMS = new Set(["pickRuler", "pickCompass"]);

// ASSUMED phrasing — pickRuler is the confirmed example; everything
// else follows the same pattern but hasn't been validated against
// real instructions.
function instructionText(
  atomType: string,
  toolLocation: { tool: string; x: number; y: number; distanceMeters: number } | undefined,
  values: { from?: [number, number]; to?: [number, number]; radius?: number } | undefined,
): string {
  if (PICK_ATOMS.has(atomType)) {
    if (!toolLocation) return `Pick up the tool for "${atomType}" — no location data available yet.`;
    return `Pick up the ${toolLocation.tool} at location ${toolLocation.x}, ${toolLocation.y}, ${toolLocation.distanceMeters}m away.`;
  }

  if (atomType === "placeRuler" && values?.from && values?.to) {
    return `Place the ruler between point (${values.from[0]}, ${values.from[1]}) and point (${values.to[0]}, ${values.to[1]}).`;
  }

  if (atomType === "measure" && typeof values?.radius === "number") {
    return `Set the compass to a radius of ${values.radius}mm.`;
  }

  if (atomType === "giveRobot") {
    return `Hand the tool to the robot.`;
  }

  return `Perform "${atomType}" — no specific instruction template yet.`;
}

export const humanActor = fromPromise<HumanActorOutput, HumanActorInput>(
  async ({ input }) => {
    const { job, actionsResult } = input;
    if (!job) throw new Error("humanActor requires a job");

    const pair = actionsResult ? atomForRole(actionsResult.pair, "human") : undefined;
    if (!pair?.atomType) {
      throw new Error("humanActor requires a human atom in actionsResult.pair");
    }

    const text = instructionText(
      pair.atomType,
      pair.toolLocation,
      pair.values as { from?: [number, number]; to?: [number, number]; radius?: number } | undefined,
    );

    return {
      label: "done",
      jobId: job.id,
      humanInstructions: { text, atomType: pair.atomType },
    };
  },
);