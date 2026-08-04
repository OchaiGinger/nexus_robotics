import { fromPromise } from "xstate";

type PolygonActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
};

type PolygonActorOutput = {
  label: "done";
  jobId: string;
  agent: "polygonActor";
  result: unknown;
};

export const polygonActor = fromPromise<PolygonActorOutput, PolygonActorInput>(
  async ({ input }) => {
    if (!input.job) {
      throw new Error("polygonActor requires a job");
    }

    // fetch the json file this job needs
    const json = await fetchJobJson(input.job.id);

    // run polygon-specific processing / ai call against the json
    const result = await runPolygon(json);

    return {
      label: "done",
      jobId: input.job.id,
      agent: "polygonActor",
      result,
    };
  },
);

// replace with real fetch (S3 signed url, local path, api call, etc.)
async function fetchJobJson(jobId: string) {
  // GET the json file associated with jobId
  return {};
}

// replace with real polygon logic / ai call
async function runPolygon(json: unknown) {
  // process json and produce a result
  return json;
}
