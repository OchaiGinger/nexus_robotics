import { fromPromise } from "xstate";

type HumanActorInput = {
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

type HumanActorOutput = {
  label: "done";
  jobId: string;
  humanInstructions: { text: string; atomType: string };
};

// ASSUMED phrasing per atomType — pickRuler is the one you gave an
// explicit example for; the wording pattern is reused generically for
// any human-assigned atom, but hasn't been confirmed for anything
// beyond that one example.
function instructionText(
  atomType: string,
  toolLocation?: { tool: string; x: number; y: number; distanceMeters: number },
): string {
  if (!toolLocation) {
    return `Perform "${atomType}" — no location data available yet.`;
  }
  const verb = atomType.startsWith("pick") ? "Pick up the" : atomType;
  return `${verb} ${toolLocation.tool} at location ${toolLocation.x}, ${toolLocation.y}, ${toolLocation.distanceMeters}m away.`;
}

export const humanActor = fromPromise<HumanActorOutput, HumanActorInput>(
  async ({ input }) => {
    const { job, actionsResult } = input;
    if (!job) throw new Error("humanActor requires a job");

    const pair = actionsResult?.pair;
    if (!pair?.atomType) {
      throw new Error("humanActor requires actionsResult.pair.atomType");
    }

    const text = instructionText(pair.atomType, pair.toolLocation);

    return {
      label: "done",
      jobId: job.id,
      humanInstructions: { text, atomType: pair.atomType },
    };
  },
);
