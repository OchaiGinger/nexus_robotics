// src/actors/createWaitingPendingActor.ts
import { fromPromise } from "xstate";

type AgentLabel =
  | "projectionActor"
  | "angleActor"
  | "gearActor"
  | "polygonActor";

type CreateWaitingPendingActorInput = {
  agentResult: {
    label: "done";
    jobId: string;
    agent: AgentLabel;
    result: unknown;
  };
};

type CreateWaitingPendingActorOutput = {
  label: "done";
  jobId: string;
  taskCount: number;
};

export const createWaitingPendingActor = fromPromise<
  CreateWaitingPendingActorOutput,
  CreateWaitingPendingActorInput
>(async ({ input }) => {
  if (!input.agentResult) {
    throw new Error("createWaitingPendingActor requires an agentResult");
  }

  const res = await fetch("/api/actors/create-waiting-pending", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.agentResult),
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "createWaitingPendingActor request failed");
  return data as CreateWaitingPendingActorOutput;
});
