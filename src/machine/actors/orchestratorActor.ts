import { fromPromise } from "xstate";

type JobType = "projectionAgent" | "angleAgent" | "gearAgent" | "polygonAgent";

type OrchestratorInput = {
  origin?: "newJob" | "nextBatch";
  job?: {
    id: string;
    type: JobType;
    payload: unknown;
  };
  sortGroupId?: string;
  toolResult?: { label: "done"; jobId: string; tools: unknown };
  actionsResult?: { label: "done"; jobId: string; pair: unknown };
  validationResult?: {
    label: "done";
    jobId: string;
    robotCorrect: boolean;
    humanCorrect: boolean;
    valid: boolean;
  };
};

type OrchestratorOutput = {
  route: "newJob" | "nextBatch" | "task" | "tools" | "done";
};

export const ochestratorActor = fromPromise<
  OrchestratorOutput,
  OrchestratorInput
>(async ({ input }) => {
  // CONFIRMED: a job arriving fresh from the user, first time through,
  // has no tools synthesized yet — go persist + classify it via `cue`.
  if (input.origin === "newJob") {
    return { route: "newJob" };
  }

  // CONFIRMED (by guard name symmetry with the above, not yet explicitly
  // walked through): the atomizer loop finished a job and asked for the
  // next batch — go advance the queue via `cue`.
  if (input.origin === "nextBatch") {
    return { route: "nextBatch" };
  }

  // ASSUMED: a job has been classified/agent-processed (context.job is
  // populated from that path) but has no toolResult yet — go synthesize
  // its toolset.
  if (input.job && !input.toolResult) {
    return { route: "task" };
  }

  // ASSUMED: tools exist for this job — hand off to the director to
  // atomize and execute it.
  if (input.toolResult) {
    return { route: "tools" };
  }

  // ASSUMED fallback: nothing left to do — return to idle.
  return { route: "done" };
});
