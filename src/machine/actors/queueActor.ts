import { fromPromise } from "xstate";

type JobType = "projectionAgent" | "angleAgent" | "gearAgent" | "polygonAgent";

type QueueActorInput = {
  origin: "newJob" | "nextBatch";
  job?: {
    id: string;
    type: JobType;
    payload: unknown;
  };
  sortGroupId?: string;
};

type QueueActorOutput =
  | { label: "newJob"; job: NonNullable<QueueActorInput["job"]> }
  | { label: "nextBatch"; sortGroupId: string };

export const queueActor = fromPromise<QueueActorOutput, QueueActorInput>(
  async ({ input }) => {
    const res = await fetch("/api/actors/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error ?? "queueActor request failed");
    }

    return data as QueueActorOutput;
  },
);
