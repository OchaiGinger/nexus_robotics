export type ConstructionTaskType =
  | "baseline"
  | "horizontalLine"
  | "verticalLine"
  | "angleLine"
  | "arcDrawing"
  | "lineDrawing"
  | "pointLinking"
  | "bisector";

export type ConstructionTask = {
  type: ConstructionTaskType;
  difficulty: number;
  payload: Record<string, unknown>;
};

export type ConstructionBatch = {
  agent: "angleActor" | "gearActor" | "polygonActor";
  instruction: string;
  score: number;
  steps: ConstructionTask[];
};

const NVAPI_URL =
  process.env.NVAPI_API_URL ?? "https://api.nvapi.com/v1/chat/completions";
const NVAPI_MODEL = process.env.NVAPI_MODEL ?? "meta/llama-3.1-8b-instruct";
const NVAPI_KEY = process.env.NVAPI_KEY;
const YOLO_ENV = process.env.YOLO_ENV ?? process.env.YOLO_MODEL ?? "yolov8n";

export function getYoloEnv() {
  return YOLO_ENV;
}

function normalizeBatch(
  agent: ConstructionBatch["agent"],
  raw: Partial<ConstructionBatch>,
): ConstructionBatch {
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, index) => ({
        type: step.type,
        difficulty: typeof step.difficulty === "number" ? step.difficulty : 1,
        payload: step.payload && typeof step.payload === "object" ? step.payload : {},
      }))
    : [];

  return {
    agent,
    instruction:
      typeof raw.instruction === "string"
        ? raw.instruction
        : `Generate a ${agent} construction batch with consistent mm values.`,
    score: typeof raw.score === "number" ? raw.score : steps.reduce((sum, step) => sum + step.difficulty, 0),
    steps,
  };
}

function buildAngleFallback(label: string, angleDegrees: number): ConstructionBatch {
  const referenceMm = 80;
  const lineTask = {
    type: "lineDrawing" as const,
    difficulty: 1,
    payload: {
      label,
      task: "baseline",
      valueMm: referenceMm,
      direction: "horizontal",
    },
  };

  const arcTask = {
    type: "arcDrawing" as const,
    difficulty: 3,
    payload: {
      label,
      task: "arc",
      radiusMm: referenceMm,
      fromDegrees: 0,
      toDegrees: angleDegrees,
      valueMm: referenceMm,
    },
  };

  const bisectorTask = {
    type: "bisector" as const,
    difficulty: 3,
    payload: {
      label,
      task: "bisect-angle",
      degrees: angleDegrees / 2,
      valueMm: referenceMm,
    },
  };

  const verticalTask = {
    type: "verticalLine" as const,
    difficulty: 1,
    payload: {
      label,
      task: "vertex-reference",
      valueMm: referenceMm,
      atDegrees: 0,
    },
  };

  return {
    agent: "angleActor",
    instruction:
      `Use a consistent 80 mm reference and build the ${angleDegrees}° angle from known-angle construction. First draw the baseline and a known 90° structure, then add the remainder with bisected or complementary steps so the result is equivalent to ${angleDegrees}° without changing unit values.`,
    score: 1 + 1 + 1 + 3 + 3,
    steps: [lineTask, verticalTask, arcTask, bisectorTask],
  };
}

function buildPolygonFallback(label: string, sides: number, sideLengthMm: number): ConstructionBatch {
  const referenceMm = sideLengthMm;
  return {
    agent: "polygonActor",
    instruction:
      `Construct a regular ${sides}-gon using a consistent ${referenceMm} mm side length and derive the required point-linking sequence from the regular geometry.`,
    score: sides + 2,
    steps: [
      {
        type: "baseline",
        difficulty: 1,
        payload: { label, task: "baseline", valueMm: referenceMm },
      },
      {
        type: "pointLinking",
        difficulty: 2,
        payload: {
          label,
          task: "polygon-points",
          sides,
          valueMm: referenceMm,
        },
      },
      {
        type: "lineDrawing",
        difficulty: 2,
        payload: {
          label,
          task: "connect-vertices",
          sides,
          valueMm: referenceMm,
        },
      },
    ],
  };
}

function buildGearFallback(label: string, module: number, teethCount: number, pressureAngleDegrees: number): ConstructionBatch {
  const referenceMm = module * 10;
  return {
    agent: "gearActor",
    instruction:
      `Generate a construction batch for a gear with module ${module} mm, ${teethCount} teeth, and ${pressureAngleDegrees}° pressure angle. Keep every task engineering-consistent, using the same dimension base across all steps.`,
    score: 4,
    steps: [
      {
        type: "baseline",
        difficulty: 1,
        payload: { label, task: "gear-line", valueMm: referenceMm },
      },
      {
        type: "arcDrawing",
        difficulty: 3,
        payload: {
          label,
          task: "pitch-circle",
          module,
          teethCount,
          pressureAngleDegrees,
          valueMm: referenceMm,
        },
      },
      {
        type: "pointLinking",
        difficulty: 2,
        payload: {
          label,
          task: "tooth-reference",
          teethCount,
          valueMm: referenceMm,
        },
      },
    ],
  };
}

async function askNvapi<T>(
  agent: ConstructionBatch["agent"],
  prompt: string,
  fallback: T,
): Promise<T> {
  if (!NVAPI_KEY) {
    return fallback;
  }

  const response = await fetch(NVAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NVAPI_KEY}`,
    },
    body: JSON.stringify({
      model: NVAPI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Return only JSON. Keep task names from the allowed set: baseline, horizontalLine, verticalLine, angleLine, arcDrawing, lineDrawing, pointLinking, bisector. Keep the same unit and same reference value across every step in the payload.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return fallback;
  }

  try {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return fallback;
    }

    const parsed = JSON.parse(content) as Partial<ConstructionBatch>;
    return normalizeBatch(agent, parsed) as T;
  } catch {
    return fallback;
  }
}

export async function generateAngleBatch(payload: {
  label: string;
  angleDegrees: number;
}): Promise<ConstructionBatch> {
  const prompt = `Build a single JSON construction batch for angle ${payload.label || "unnamed"} with target ${payload.angleDegrees}°. For angles like 135°, use known-angle decomposition using 90° plus a 45° component derived by bisecting a 90° reference. Keep all values consistent and use a stable reference value of 80 mm for any baseline, line, or arc step. Return the JSON with the fields instruction, score, and steps.`;

  const fallback = buildAngleFallback(payload.label, payload.angleDegrees);
  return askNvapi("angleActor", prompt, fallback);
}

export async function generatePolygonBatch(payload: {
  label: string;
  sides: number;
  sideLengthMm: number;
}): Promise<ConstructionBatch> {
  const prompt = `Build a single JSON construction batch for polygon ${payload.label || "unnamed"} with ${payload.sides} sides and side length ${payload.sideLengthMm} mm. Populate a consistent task list using the canonical task names, and keep all step payloads in the same mm unit and same reference dimension. Return the JSON with the fields instruction, score, and steps.`;

  const fallback = buildPolygonFallback(
    payload.label,
    payload.sides,
    payload.sideLengthMm,
  );
  return askNvapi("polygonActor", prompt, fallback);
}

export async function generateGearBatch(payload: {
  label: string;
  module: number;
  teethCount: number;
  pressureAngleDegrees: number;
}): Promise<ConstructionBatch> {
  const prompt = `Build a single JSON construction batch for gear ${payload.label || "unnamed"} with module ${payload.module} mm, ${payload.teethCount} teeth, and pressure angle ${payload.pressureAngleDegrees}°. Keep every task payload consistent and dimensionally coherent across the entire chunk. Return the JSON with the fields instruction, score, and steps.`;

  const fallback = buildGearFallback(
    payload.label,
    payload.module,
    payload.teethCount,
    payload.pressureAngleDegrees,
  );
  return askNvapi("gearActor", prompt, fallback);
}
