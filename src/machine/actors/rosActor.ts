// src/actors/rosActor.ts
import { fromPromise } from "xstate";
import { publishToRos } from "@/lib/rosBridge";

type RosActorInput = {
  job: { id: string; payload: unknown };
  actionId: string;
  source: "robot" | "human";
  payload: unknown;
};

type RosActorOutput = {
  label: "done";
  jobId: string;
  source: "robot" | "human";
  acked: true;
};

export const rosActor = fromPromise<RosActorOutput, RosActorInput>(
  async ({ input }) => {
    const { job, actionId, source, payload } = input;
    if (!job) throw new Error("rosActor requires a job");
    if (!actionId) throw new Error("rosActor requires an actionId");

    const ack = await publishToRos(actionId, source, payload);

    return {
      label: "done",
      jobId: job.id,
      source,
      acked: ack.acked,
    };
  },
);