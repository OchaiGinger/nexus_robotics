// src/actors/updateActionsTableActor.ts
import { fromPromise } from "xstate";
import { ActionPair } from "./types";

type UpdateActionsTableActorInput = {
  job: { id: string; payload: unknown };
  actionsResult: {
    label: "done";
    jobId: string;
    pair: ActionPair;
  };
  validationResult: {
    label: "done";
    jobId: string;
    robotCorrect: boolean;
    humanCorrect: boolean;
    valid: boolean;
  };
};

type UpdateActionsTableActorOutput = {
  actionsResult: {
    label: "done";
    jobId: string;
    pair: ActionPair; // was `unknown`
  };
};

export const updateActionsTableActor = fromPromise<
  UpdateActionsTableActorOutput,
  UpdateActionsTableActorInput
>(async ({ input }) => {
  if (!input.actionsResult)
    throw new Error("updateActionsTableActor requires an actionsResult");

  const res = await fetch("/api/actors/update-actions-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "updateActionsTableActor request failed");
  return data as UpdateActionsTableActorOutput;
});
