import { fromPromise } from "xstate";

type SortGroupActorInput = {
  jobId: string;
};

type SortGroupActorOutput = {
  label: "done";
  sortGroupId: string;
};

export const sortGroupActor = fromPromise<
  SortGroupActorOutput,
  SortGroupActorInput
>(async ({ input }) => {
  if (!input.jobId) {
    throw new Error("sortGroupActor requires a jobId");
  }

  const res = await fetch("/api/actors/sort-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: input.jobId }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? "sortGroupActor request failed");
  }

  return data as SortGroupActorOutput;
});
