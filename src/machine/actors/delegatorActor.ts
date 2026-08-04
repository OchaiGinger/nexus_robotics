// src/actors/delegatorActor.ts
import { fromPromise } from "xstate";

type DelegatorActorInput = {
  job: { id: string };
  actionsResult: { label: "done"; jobId: string; pair: any };
};

type DelegatorActorOutput = {
  label: "done";
  jobId: string;
  role: "robot" | "human";
  actionsResult: { label: "done"; jobId: string; pair: any };
};

// CONFIRMED / ASSUMED per atomType — see note above the table.
const ATOM_ROLE: Record<string, "robot" | "human"> = {
  pickPencil: "robot", // CONFIRMED
  markPointX: "robot", // CONFIRMED (drawing itself)
  markPointY: "robot", // CONFIRMED (drawing itself)
  calibrate: "robot", // ASSUMED
  pickRuler: "human", // ASSUMED
  execute: "human", // ASSUMED fallback for placeholder atom types
};

export const delegatorActor = fromPromise<
  DelegatorActorOutput,
  DelegatorActorInput
>(async ({ input }) => {
  const pair = input.actionsResult?.pair;
  if (!pair?.atomType) {
    throw new Error("delegatorActor requires actionsResult.pair.atomType");
  }

  const role = ATOM_ROLE[pair.atomType] ?? "human"; // unmapped atomType defaults to human, flagged for visibility
  if (!ATOM_ROLE[pair.atomType]) {
    console.warn(
      `delegatorActor: no role mapping for atomType "${pair.atomType}", defaulting to human`,
    );
  }

  return {
    label: "done",
    jobId: input.job.id,
    role,
    actionsResult: input.actionsResult,
  };
});
