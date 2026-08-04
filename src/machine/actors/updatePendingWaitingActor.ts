// src/actors/updatePendingWaitingActor.ts
import { fromPromise } from "xstate";

type UpdatePendWaitingInput = { sortGroupId: string };
type UpdatePendWaitingOutput = { label: "done"; sortGroupId: string };

export const updatePendWaitingActor = fromPromise<
  UpdatePendWaitingOutput,
  UpdatePendWaitingInput
>(async ({ input }) => {
  if (!input.sortGroupId) {
    throw new Error("updatePendWaitingActor requires a sortGroupId");
  }

  const res = await fetch("/api/actors/update-pend-waiting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sortGroupId: input.sortGroupId }),
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "updatePendWaitingActor request failed");
  return data as UpdatePendWaitingOutput;
});
