// src/actors/createActionsTableActor.ts
import { fromPromise } from "xstate";

type CreateActionsTableActorInput = {
  actionsResult: { label: "done"; jobId: string; pair: unknown };
};
type CreateActionsTableActorOutput = {
  label: "done";
  jobId: string;
  pair: unknown;
};

export const createActionsTableActor = fromPromise<
  CreateActionsTableActorOutput,
  CreateActionsTableActorInput
>(async ({ input }) => {
  if (!input.actionsResult)
    throw new Error("createActionsTableActor requires an actionsResult");

  const res = await fetch("/api/actors/create-actions-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.actionsResult),
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "createActionsTableActor request failed");
  return data as CreateActionsTableActorOutput;
});
