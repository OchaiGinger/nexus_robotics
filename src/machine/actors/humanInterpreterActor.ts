import { fromPromise } from "xstate";

type HumanInterpreterActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
  humanInstructions: unknown;
};

type HumanInterpreterActorOutput = {
  label: "done";
  jobId: string;
  humanResult: unknown;
};

export const humanInterpreterActor = fromPromise<
  HumanInterpreterActorOutput,
  HumanInterpreterActorInput
>(async ({ input }) => {
  const { job, humanInstructions } = input;

  if (!job) {
    throw new Error("humanInterpreterActor requires a job");
  }

  // watch/listen for the human's response to the instructions (speech,
  // gesture, button press, etc.) and interpret it into a structured
  // result the rest of the pipeline can hand off to ROS
  const humanResult = await interpretHumanResponse(job, humanInstructions);

  return {
    label: "done",
    jobId: job.id,
    humanResult,
  };
});

// replace with real interpretation logic (speech/gesture/vision model, etc.)
async function interpretHumanResponse(
  job: HumanInterpreterActorInput["job"],
  humanInstructions: unknown,
): Promise<unknown> {
  return {};
}
