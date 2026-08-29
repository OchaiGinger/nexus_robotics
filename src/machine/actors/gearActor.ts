import { fromPromise } from "xstate";

type GearActorInput = {
  job: {
    id: string;
    payload: {
      label: string;
      module: number;
      teethCount: number;
      pressureAngleDegrees: number;
      faceWidthMm: number;
    };
  };
};

type GearActorOutput = {
  label: "done";
  jobId: string;
  agent: "gearActor";
  result: {
    calculated: {
      pitchDiameterMm: number;
      addendumMm: number;
      dedendumMm: number;
      outsideDiameterMm: number;
      rootDiameterMm: number;
      baseDiameterMm: number;
      circularPitchMm: number;
      toothThicknessMm: number;
    };
    tasks: GearTask[];
  };
};

export type GearTask = {
  task: string;
  value: string | number;
  unit: string;
};

export const gearActor = fromPromise<GearActorOutput, GearActorInput>(
  async ({ input }) => {
    if (!input.job) {
      throw new Error("gearActor requires a job");
    }

    const { module, teethCount, pressureAngleDegrees, faceWidthMm } =
      input.job.payload;
    const apiKey = process.env.NEXUS_AI_API_KEY;
    const apiUrl = process.env.NEXUS_AI_API_URL;
    const model = process.env.NEXUS_AI_MODEL;

    const calculated = calculateGearDimensions(
      module,
      teethCount,
      pressureAngleDegrees,
    );

    const tasks = buildGearTasks(module, teethCount, calculated);

    if (apiKey && apiUrl && model) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are a mechanical engineering assistant for gear construction. Given gear parameters (module, teeth count, pressure angle, face width), calculate derived dimensions and generate step-by-step construction tasks. Return JSON with \"tasks\" array containing objects with \"task\" (description), \"value\" (numeric or string), and \"unit\" (mm, degrees, etc).",
              },
              {
                role: "user",
                content: `Generate construction tasks for a spur gear with: module=${module}mm, teeth=${teethCount}, pressure angle=${pressureAngleDegrees} degrees, face width=${faceWidthMm}mm. Calculated: pitch diameter=${calculated.pitchDiameterMm}mm, outside diameter=${calculated.outsideDiameterMm}mm, root diameter=${calculated.rootDiameterMm}mm.`,
              },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            if (parsed.tasks && Array.isArray(parsed.tasks)) {
              return {
                label: "done",
                jobId: input.job.id,
                agent: "gearActor",
                result: {
                  calculated,
                  tasks: parsed.tasks,
                },
              };
            }
          }
        }
      } catch {
        // fall through to local computation
      }
    }

    return {
      label: "done",
      jobId: input.job.id,
      agent: "gearActor",
      result: {
        calculated,
        tasks,
      },
    };
  },
);

function calculateGearDimensions(
  module: number,
  teethCount: number,
  pressureAngleDegrees: number,
) {
  const pitchDiameterMm = module * teethCount;
  const addendumMm = module;
  const dedendumMm = 1.25 * module;
  const outsideDiameterMm = pitchDiameterMm + 2 * addendumMm;
  const rootDiameterMm = pitchDiameterMm - 2 * dedendumMm;
  const baseDiameterMm = pitchDiameterMm * Math.cos((pressureAngleDegrees * Math.PI) / 180);
  const circularPitchMm = Math.PI * module;
  const toothThicknessMm = circularPitchMm / 2;

  return {
    pitchDiameterMm: round(pitchDiameterMm),
    addendumMm: round(addendumMm),
    dedendumMm: round(dedendumMm),
    outsideDiameterMm: round(outsideDiameterMm),
    rootDiameterMm: round(rootDiameterMm),
    baseDiameterMm: round(baseDiameterMm),
    circularPitchMm: round(circularPitchMm),
    toothThicknessMm: round(toothThicknessMm),
  };
}

function buildGearTasks(
  module: number,
  teethCount: number,
  calculated: ReturnType<typeof calculateGearDimensions>,
): GearTask[] {
  const tasks: GearTask[] = [];

  tasks.push({
    task: "Draw pitch circle",
    value: calculated.pitchDiameterMm / 2,
    unit: "mm radius",
  });

  tasks.push({
    task: "Draw outside diameter circle",
    value: calculated.outsideDiameterMm / 2,
    unit: "mm radius",
  });

  tasks.push({
    task: "Draw root diameter circle",
    value: calculated.rootDiameterMm / 2,
    unit: "mm radius",
  });

  tasks.push({
    task: "Draw base diameter circle",
    value: calculated.baseDiameterMm / 2,
    unit: "mm radius",
  });

  const angularSpacing = 360 / teethCount;
  tasks.push({
    task: `Mark ${teethCount} equally spaced tooth positions`,
    value: round(angularSpacing),
    unit: "degrees apart",
  });

  tasks.push({
    task: "Draw tooth thickness at pitch circle",
    value: calculated.toothThicknessMm,
    unit: "mm",
  });

  tasks.push({
    task: "Draw involute tooth profile using base circle",
    value: calculated.baseDiameterMm / 2,
    unit: "mm radius",
  });

  tasks.push({
    task: "Repeat tooth profile for all teeth",
    value: teethCount,
    unit: "teeth",
  });

  return tasks;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
