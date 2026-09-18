import { fromPromise } from "xstate";

type ProjectionJob = {
  id: string;
  payload: unknown;
};

type ProjectionActorInput = {
  job: ProjectionJob;
};

type ProjectionArtifact = {
  kind: "local-preview" | "provider";
  vertices?: number[][];
  faces?: number[][];
  modelUrl?: string;
  renderUrl?: string;
  provider?: string;
};

type ProjectionActorOutput = {
  label: "done";
  jobId: string;
  agent: "projectionActor";
  result: {
    artifact: ProjectionArtifact;
    steps: Array<Record<string, unknown>>;
  };
};

type ProjectionApiResponse = {
  jobId?: string;
  artifact?: ProjectionArtifact;
  steps?: Array<Record<string, unknown>>;
  error?: string;
};

export const projectionActor = fromPromise<
  ProjectionActorOutput,
  ProjectionActorInput
>(async ({ input }) => {
  if (!input.job) {
    throw new Error("projectionActor requires a job");
  }

  const response = await fetch("/api/projection/reconstruct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId: input.job.id,
      payload: input.job.payload,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as ProjectionApiResponse;
  if (!response.ok || !data.artifact || !Array.isArray(data.steps)) {
    throw new Error(data.error ?? `Projection request failed (${response.status})`);
  }

  return {
    label: "done",
    jobId: input.job.id,
    agent: "projectionActor",
    result: {
      artifact: data.artifact,
      steps: data.steps,
    },
  };
});
