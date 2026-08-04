import { fromPromise } from "xstate";

type ValidatorActorInput = {
  job: {
    id: string;
    payload: unknown;
  };
  robotRosResult: unknown;
  humanRosResult: unknown;
};

type ValidatorActorOutput = {
  label: "done";
  jobId: string;
  robotCorrect: boolean;
  humanCorrect: boolean;
  valid: boolean;
};

export const validatorActor = fromPromise<
  ValidatorActorOutput,
  ValidatorActorInput
>(async ({ input }) => {
  const { job, robotRosResult, humanRosResult } = input;

  if (!job) {
    throw new Error("validatorActor requires a job");
  }

  // both parallel regions (robot, human) have already hit their own
  // final state by the time this runs — check that each one actually
  // did the right thing, and that they agree with each other
  const robotCorrect = await checkRobotResult(job, robotRosResult);
  const humanCorrect = await checkHumanResult(job, humanRosResult);

  return {
    label: "done",
    jobId: job.id,
    robotCorrect,
    humanCorrect,
    valid: robotCorrect && humanCorrect,
  };
});

// replace with real robot-result validation logic
async function checkRobotResult(
  job: ValidatorActorInput["job"],
  robotRosResult: unknown,
): Promise<boolean> {
  return true;
}

// replace with real human-result validation logic
async function checkHumanResult(
  job: ValidatorActorInput["job"],
  humanRosResult: unknown,
): Promise<boolean> {
  return true;
}
