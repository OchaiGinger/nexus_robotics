// src/actors/atomizerActor.ts
import { fromPromise } from "xstate";

type AtomizerActorInput = {
  job: { id: string; payload: unknown };
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

type AtomizerActorOutput =
  | { label: "done"; jobId: string; route: "actions"; pair: unknown }
  | { label: "done"; jobId: string; route: "taskDone"; hasMoreTasks: boolean };

export const atomizerActor = fromPromise<
  AtomizerActorOutput,
  AtomizerActorInput
>(async ({ input }) => {
  if (!input.job) throw new Error("atomizerActor requires a job");

  const res = await fetch("/api/actors/atomizer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "atomizerActor request failed");
  return data as AtomizerActorOutput;
});
