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
};

export const validateJobActor = fromPromise<
  ValidateJobOutput,
  ValidateJobInput
>(async ({ input }) => {
  if (!input.job) {
    throw new Error("No job provided to validateJob");
  }

  const isValid = checkParameters(input.job);
  if (!isValid) {
    throw new Error(`Invalid parameters for job type: ${input.job.type}`);
  }

  return { label: input.job.type, job: input.job };
});

function checkParameters(job: ValidateJobInput["job"]): boolean {
  // per-type parameter validation goes here
  switch (job.type) {
    case "projectionAgent":
      return true; // replace with real checks
    case "angleAgent":
      return true;
    case "gearAgent":
      return true;
    case "polygonAgent":
      return true;
    default:
      return false;
  }
}
