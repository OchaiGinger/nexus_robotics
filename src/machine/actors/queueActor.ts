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

    const data = await res.json().catch(() => ({})) as {
      error?: string;
      retryable?: boolean;
    };

    if (!res.ok) {
      const retryable = data.retryable ? " Retry is safe." : "";
      throw new Error(`queueActor request failed (${res.status}): ${data.error ?? "Unknown error"}${retryable}`);
    }

    return data as QueueActorOutput;
  },
);
