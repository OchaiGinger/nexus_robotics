import { fromPromise } from "xstate";

type JobType = "projectionAgent" | "angleAgent" | "gearAgent" | "polygonAgent";

type ValidateJobInput = {
  job: {
    id: string;
    type: JobType;
    payload: unknown;
  };
};

type ValidateJobOutput = {
  label: JobType;
  job: ValidateJobInput["job"];
} | {
  label: "invalid";
  reason: string;
};

export const validateJobActor = fromPromise<
  ValidateJobOutput,
  ValidateJobInput
>(async ({ input }) => {
  if (!input.job) {
    throw new Error("No job provided to validateJob");
  }

  const response = await fetch("/api/jobs/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.job),
  });

  const result = await response.json() as {
    valid?: boolean;
    reason?: string;
  };

  if (!response.ok || !result.valid) {
    return {
      label: "invalid",
      reason: result.reason ?? `Validation request failed (${response.status})`,
    };
  }

  return { label: input.job.type, job: input.job };
});
