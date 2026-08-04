import { fromPromise } from "xstate";

type GearActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
};

type GearActorOutput = {
  label: "done";
  jobId: string;
  agent: "gearActor";
  result: unknown;
};

export const gearActor = fromPromise<GearActorOutput, GearActorInput>(
  async ({ input }) => {
    if (!input.job) {
      throw new Error("gearActor requires a job");
    }

    // fetch the json file this job needs
    const json = await fetchJobJson(input.job.id);

    // run gear-specific processing / ai call against the json
    const result = await runGear(json);

    return {
      label: "done",
      jobId: input.job.id,
      agent: "gearActor",
      result,
    };
  },
);

// replace with real fetch (S3 signed url, local path, api call, etc.)
async function fetchJobJson(jobId: string) {
  // GET the json file associated with jobId
  return {};
}

// replace with real gear logic / ai call
async function runGear(json: unknown) {
  // process json and produce a result
  return json;
}
