// src/actors/orchestratorActor.ts
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
  jobId?: string;
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
  if (input.origin === "newJob") {
    return { route: "newJob" };
  }

  if (input.origin === "nextBatch") {
    return { route: "nextBatch" };
  }

  // A sortGroup's tasks were just promoted to "pending" — ready for
  // tool synthesis/execution on this job.
  if (input.sortGroupId && input.jobId && !input.toolResult) {
    return { route: "tools" };
  }

  if (input.job && !input.toolResult) {
    return { route: "task" };
  }

  if (input.toolResult) {
    return { route: "tools" };
  }

  return { route: "done" };
});