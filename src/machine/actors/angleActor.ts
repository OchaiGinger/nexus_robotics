import { fromPromise } from "xstate";

export type AngleStep = {
  type: "baseline" | "angleLine" | "verticalLine" | "bisector";
  difficulty: number;
  payload: unknown;
};

type AngleActorInput = {
  job: {
    id: string;
    payload: {
      label: string;
      angleDegrees: number;
    };
  };
};

type AngleActorOutput = {
  label: "done";
  jobId: string;
  agent: "angleActor";
  result: AngleStep[];
};

// fixed placeholder difficulty per step type — tune once real scoring exists
const STEP_DIFFICULTY: Record<AngleStep["type"], number> = {
  baseline: 1,
  angleLine: 2,
  verticalLine: 1,
  bisector: 3,
};

export const angleActor = fromPromise<AngleActorOutput, AngleActorInput>(
  async ({ input }) => {
    if (!input.job) {
      throw new Error("angleActor requires a job");
    }

    const steps = buildAngleSteps(input.job.payload);

    return {
      label: "done",
      jobId: input.job.id,
      agent: "angleActor",
      result: steps,
    };
  },
);

// builds the construction steps needed to draw this angle: a baseline,
// the angle ray itself, vertical reference lines at each end, and the
// bisector
function buildAngleSteps(payload: {
  label: string;
  angleDegrees: number;
}): AngleStep[] {
  const { label, angleDegrees } = payload;

  return [
    {
      type: "baseline",
      difficulty: STEP_DIFFICULTY.baseline,
      payload: { label, fromDegrees: 0, toDegrees: 0 },
    },
    {
      type: "angleLine",
      difficulty: STEP_DIFFICULTY.angleLine,
      payload: { label, degrees: angleDegrees },
    },
    {
      type: "verticalLine",
      difficulty: STEP_DIFFICULTY.verticalLine,
      payload: {
        label,
        atDegrees: 0,
        note: "vertical construction line at vertex",
      },
    },
    {
      type: "verticalLine",
      difficulty: STEP_DIFFICULTY.verticalLine,
      payload: {
        label,
        atDegrees: angleDegrees,
        note: "vertical construction line at ray end",
      },
    },
    {
      type: "bisector",
      difficulty: STEP_DIFFICULTY.bisector,
      payload: { label, degrees: angleDegrees / 2 },
    },
  ];
}
