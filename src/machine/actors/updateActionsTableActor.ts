// src/actors/updateActionsTableActor.ts
import { fromPromise } from "xstate";

export type UpdateActionsTableActorInput = {
  actionId: string;
  status: "pending" | "completed";
};

type UpdateActionsTableActorOutput = {
  label: "done";
  actionId: string;
  status: "pending" | "completed";
  pair: unknown;
};

export const updateActionsTableActor = fromPromise<
  UpdateActionsTableActorOutput,
  UpdateActionsTableActorInput
>(async ({ input }) => {
  if (!input.actionId || !input.status)
    throw new Error("actionId and status are required");

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
