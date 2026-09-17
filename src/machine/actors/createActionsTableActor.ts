// src/actors/createActionsTableActor.ts
import { fromPromise } from "xstate";

type CreateActionsTableInput = { jobId: string; actions: unknown[] };
type CreateActionsTableOutput = { label: "done"; jobId: string; count: number };

export const createActionsTableActor = fromPromise<
  CreateActionsTableOutput,
  CreateActionsTableInput
>(async ({ input }) => {
  const res = await fetch("/api/actors/create-actions-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "createActionsTableActor request failed");
  return data as CreateActionsTableOutput;
});