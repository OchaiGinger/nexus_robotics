import { fromPromise } from "xstate";

type RosActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
  // which branch of the middleman parallel state this execution belongs to
  source: "robot" | "human";
  // robotPlan (robot branch) or humanResult (human branch)
  payload: unknown;
};

type RosActorOutput = {
  label: "done";
  jobId: string;
  source: "robot" | "human";
  rosResult: unknown;
};

export const rosActor = fromPromise<RosActorOutput, RosActorInput>(
  async ({ input }) => {
    const { job, source, payload } = input;

    if (!job) {
      throw new Error("rosActor requires a job");
    }

    // publish/execute against ROS and await the execution result, tagged
    // with which branch (robot/human) it came from so the validator can
    // tell them apart
    const rosResult = await executeOnRos(job, source, payload);

    return {
      label: "done",
      jobId: job.id,
      source,
      rosResult,
    };
  },
);

// replace with real ROS bridge logic (rosbridge/rclnodejs/etc.)
async function executeOnRos(
  job: RosActorInput["job"],
  source: RosActorInput["source"],
  payload: unknown,
): Promise<unknown> {
  return {};
}
