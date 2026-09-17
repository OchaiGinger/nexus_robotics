// src/actors/validatorActor.ts
import { fromPromise } from "xstate";

type ValidatorActorInput = {
  job: { id: string; payload: unknown };
  actionId: string;
  mode: "single" | "both";
  role?: "robot" | "human"; // required when mode === "single"
};

type ValidatorActorOutput = {
  label: "done";
  jobId: string;
  actionId: string;
  robotCorrect: boolean;
  humanCorrect: boolean;
  valid: boolean;
};

export const validatorActor = fromPromise<
  ValidatorActorOutput,
  ValidatorActorInput
>(async ({ input }) => {
  if (!input.job) throw new Error("validatorActor requires a job");
  if (!input.actionId) throw new Error("validatorActor requires an actionId");
  if (input.mode === "single" && !input.role) {
    throw new Error("validatorActor requires a role when mode is 'single'");
  }

  const res = await fetch("/api/actors/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "validatorActor request failed");
  return data as ValidatorActorOutput;
});