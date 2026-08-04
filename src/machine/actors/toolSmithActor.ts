// src/actors/toolSmithActor.ts
import { fromPromise } from "xstate";

type ToolSmithActorInput = { job: { id: string; payload: unknown } };
type ToolSmithTaskRecord = { id: string; type: string; payload: unknown };
type ToolSmithActorOutput = {
  label: "done";
  jobId: string;
  tools: ToolSmithTaskRecord[];
};

export const toolSmithActor = fromPromise<
  ToolSmithActorOutput,
  ToolSmithActorInput
>(async ({ input }) => {
  if (!input.job) throw new Error("toolSmithActor requires a job");

  const res = await fetch(`/api/actors/tool-smith?jobId=${input.job.id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "toolSmithActor request failed");
  return data as ToolSmithActorOutput;
});
