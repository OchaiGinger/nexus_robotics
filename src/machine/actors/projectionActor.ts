import { fromPromise } from "xstate";

type ProjectionActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
};

type ProjectionActorOutput = {
  label: "done";
  jobId: string;
  agent: "projectionActor";
  result: unknown;
};

export const projectionActor = fromPromise<
  ProjectionActorOutput,
  ProjectionActorInput
>(async ({ input }) => {
  if (!input.job) {
    throw new Error("projectionActor requires a job");
  }

  // fetch the json file this job needs
  const json = await fetchJobJson(input.job.id);

  // run projection-specific processing / ai call against the json
  const result = await runProjection(json);

  return {
    label: "done",
    jobId: input.job.id,
    agent: "projectionActor",
    result,
  };
});

// replace with real fetch (S3 signed url, local path, api call, etc.)
async function fetchJobJson(jobId: string) {
  // GET the json file associated with jobId
  return {};
}

// replace with real projection logic / ai call
async function runProjection(json: unknown) {
  // process json and produce a result
  return json;
}
