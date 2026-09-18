// src/machine/actors/humanInterpreterActor.ts
import { fromPromise } from "xstate";

type HumanInterpreterActorInput = {
  job: { id: string; payload: unknown };
  humanInstructions: { text: string; atomType: string };
};

type HumanInterpreterActorOutput = {
  label: "done";
  jobId: string;
  humanResult: { text: string; atomType: string };
};

export const humanInterpreterActor = fromPromise<
  HumanInterpreterActorOutput,
  HumanInterpreterActorInput
>(async ({ input }) => {
  if (!input.job) throw new Error("humanInterpreterActor requires a job");
  if (!input.humanInstructions?.text) {
    throw new Error("humanInterpreterActor requires humanInstructions.text");
  }

  const res = await fetch("/api/actors/human-interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "humanInterpreterActor request failed");
  return data as HumanInterpreterActorOutput;
});