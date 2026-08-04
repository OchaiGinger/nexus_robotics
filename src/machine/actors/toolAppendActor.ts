// src/actors/toolAppendActor.ts
import { fromPromise } from "xstate";

type ToolAppendActorInput = {
  toolResult: { label: "done"; jobId: string; tools: unknown };
};
type ToolAppendActorOutput = { label: "done"; jobId: string };

export const toolAppendActor = fromPromise<
  ToolAppendActorOutput,
  ToolAppendActorInput
>(async ({ input }) => {
  if (!input.toolResult)
    throw new Error("toolAppendActor requires a toolResult");

  const res = await fetch("/api/actors/tool-append", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.toolResult),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "toolAppendActor request failed");
  return data as ToolAppendActorOutput;
});
