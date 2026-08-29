import { fromPromise } from "xstate";

type PolygonDimensions =
  | { type: "equilateral"; sideLengthMm: number }
  | { type: "isosceles"; baseLengthMm: number; equalSideLengthMm: number }
  | { type: "scalene"; sideAMm: number; sideBMm: number; sideCMm: number }
  | { sideLengthMm: number }
  | { widthMm: number; heightMm: number };

type PolygonActorInput = {
  job: {
    id: string;
    payload: {
      label: string;
      polygonType: string;
      dimensions: PolygonDimensions;
    };
  };
};

type PolygonActorOutput = {
  label: "done";
  jobId: string;
  agent: "polygonActor";
  result: {
    polygonType: string;
    calculated: Record<string, number>;
    tasks: PolygonTask[];
  };
};

export type PolygonTask = {
  task: string;
  value: string | number;
  unit: string;
};

export const polygonActor = fromPromise<PolygonActorOutput, PolygonActorInput>(
  async ({ input }) => {
    if (!input.job) {
      throw new Error("polygonActor requires a job");
    }

    const { polygonType, dimensions } = input.job.payload;
    const apiKey = process.env.NEXUS_AI_API_KEY;
    const apiUrl = process.env.NEXUS_AI_API_URL;
    const model = process.env.NEXUS_AI_MODEL;

    const calculated = calculatePolygonDimensions(polygonType, dimensions);
    const tasks = buildPolygonTasks(polygonType, dimensions, calculated);

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
                  "You are a geometric construction assistant for polygon drawing. Given a polygon type and dimensions, generate step-by-step construction tasks. Return JSON with \"tasks\" array containing objects with \"task\" (description), \"value\" (numeric or string), and \"unit\" (mm, degrees, etc).",
              },
              {
                role: "user",
                content: `Generate construction tasks for a ${polygonType} with dimensions: ${JSON.stringify(dimensions)}. Calculated values: ${JSON.stringify(calculated)}.`,
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
                agent: "polygonActor",
                result: {
                  polygonType,
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
      agent: "polygonActor",
      result: {
        polygonType,
        calculated,
        tasks,
      },
    };
  },
);

function calculatePolygonDimensions(
  polygonType: string,
  dimensions: PolygonDimensions,
): Record<string, number> {
  const results: Record<string, number> = {};

  if (polygonType === "triangle") {
    if (dimensions.type === "equilateral") {
      const s = dimensions.sideLengthMm;
      results.sideLength = s;
      results.height = (Math.sqrt(3) / 2) * s;
      results.perimeter = 3 * s;
      results.area = (Math.sqrt(3) / 4) * s * s;
      results.internalAngle = 60;
    } else if (dimensions.type === "isosceles") {
      const { baseLengthMm, equalSideLengthMm } = dimensions;
      results.base = baseLengthMm;
      results.equalSides = equalSideLengthMm;
      results.height = Math.sqrt(
        equalSideLengthMm ** 2 - (baseLengthMm / 2) ** 2,
      );
      results.perimeter = baseLengthMm + 2 * equalSideLengthMm;
      results.area = (baseLengthMm * results.height) / 2;
    } else if (dimensions.type === "scalene") {
      const { sideAMm, sideBMm, sideCMm } = dimensions;
      results.sideA = sideAMm;
      results.sideB = sideBMm;
      results.sideC = sideCMm;
      const s = (sideAMm + sideBMm + sideCMm) / 2;
      results.perimeter = sideAMm + sideBMm + sideCMm;
      results.area = Math.sqrt(
        s * (s - sideAMm) * (s - sideBMm) * (s - sideCMm),
      );
    }
  } else if (polygonType === "square") {
    const s = (dimensions as { sideLengthMm: number }).sideLengthMm;
    results.sideLength = s;
    results.diagonal = s * Math.sqrt(2);
    results.perimeter = 4 * s;
    results.area = s * s;
    results.internalAngle = 90;
  } else if (polygonType === "rectangle") {
    const { widthMm, heightMm } = dimensions as {
      widthMm: number;
      heightMm: number;
    };
    results.width = widthMm;
    results.height = heightMm;
    results.diagonal = Math.sqrt(widthMm ** 2 + heightMm ** 2);
    results.perimeter = 2 * (widthMm + heightMm);
    results.area = widthMm * heightMm;
  } else {
    const sides = getPolygonSides(polygonType);
    const s = (dimensions as { sideLengthMm: number }).sideLengthMm;
    results.sideLength = s;
    results.numSides = sides;
    results.internalAngle = ((sides - 2) * 180) / sides;
    results.centralAngle = 360 / sides;
    results.perimeter = sides * s;
    results.apothem = s / (2 * Math.tan(Math.PI / sides));
    results.area = (results.perimeter * results.apothem) / 2;
  }

  return Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, round(v)]),
  );
}

function buildPolygonTasks(
  polygonType: string,
  dimensions: PolygonDimensions,
  calculated: Record<string, number>,
): PolygonTask[] {
  const tasks: PolygonTask[] = [];

  if (polygonType === "triangle") {
    if (dimensions.type === "equilateral") {
      const s = dimensions.sideLengthMm;
      tasks.push({ task: "Draw base line", value: s, unit: "mm" });
      tasks.push({
        task: "Draw arc from left endpoint with radius equal to side length",
        value: s,
        unit: "mm",
      });
      tasks.push({
        task: "Draw arc from right endpoint with radius equal to side length",
        value: s,
        unit: "mm",
      });
      tasks.push({
        task: "Connect intersection point to both endpoints",
        value: 60,
        unit: "degrees at each vertex",
      });
    } else if (dimensions.type === "isosceles") {
      const { baseLengthMm, equalSideLengthMm } = dimensions;
      tasks.push({ task: "Draw base line", value: baseLengthMm, unit: "mm" });
      tasks.push({
        task: "Draw arc from left endpoint with radius equal to side length",
        value: equalSideLengthMm,
        unit: "mm",
      });
      tasks.push({
        task: "Draw arc from right endpoint with radius equal to side length",
        value: equalSideLengthMm,
        unit: "mm",
      });
      tasks.push({
        task: "Connect intersection point to both endpoints",
        value: round(calculated.height),
        unit: "mm height",
      });
    } else if (dimensions.type === "scalene") {
      const { sideAMm, sideBMm, sideCMm } = dimensions;
      tasks.push({ task: "Draw side A", value: sideAMm, unit: "mm" });
      tasks.push({
        task: "Draw arc from endpoint A with radius equal to side B",
        value: sideBMm,
        unit: "mm",
      });
      tasks.push({
        task: "Draw arc from endpoint B with radius equal to side C",
        value: sideCMm,
        unit: "mm",
      });
      tasks.push({
        task: "Connect intersection to form triangle",
        value: 3,
        unit: "sides total",
      });
    }
  } else if (polygonType === "square") {
    const s = (dimensions as { sideLengthMm: number }).sideLengthMm;
    tasks.push({ task: "Draw horizontal baseline", value: s, unit: "mm" });
    tasks.push({ task: "Draw vertical line at left endpoint", value: s, unit: "mm" });
    tasks.push({ task: "Draw vertical line at right endpoint", value: s, unit: "mm" });
    tasks.push({ task: "Connect tops with horizontal line", value: s, unit: "mm" });
  } else if (polygonType === "rectangle") {
    const { widthMm, heightMm } = dimensions as {
      widthMm: number;
      heightMm: number;
    };
    tasks.push({ task: "Draw horizontal baseline (width)", value: widthMm, unit: "mm" });
    tasks.push({ task: "Draw vertical line at left (height)", value: heightMm, unit: "mm" });
    tasks.push({ task: "Draw vertical line at right (height)", value: heightMm, unit: "mm" });
    tasks.push({ task: "Connect tops with horizontal line", value: widthMm, unit: "mm" });
  } else {
    const sides = getPolygonSides(polygonType);
    const s = (dimensions as { sideLengthMm: number }).sideLengthMm;
    const centralAngle = 360 / sides;
    tasks.push({
      task: `Draw circumscribed circle with apothem ${calculated.apothem}mm`,
      value: calculated.apothem,
      unit: "mm",
    });
    tasks.push({
      task: `Mark ${sides} vertices at ${round(centralAngle)}° intervals`,
      value: round(centralAngle),
      unit: "degrees",
    });
    tasks.push({
      task: "Connect adjacent vertices with lines of length",
      value: s,
      unit: "mm",
    });
  }

  return tasks;
}

function getPolygonSides(polygonType: string): number {
  const sidesMap: Record<string, number> = {
    triangle: 3,
    square: 4,
    rectangle: 4,
    pentagon: 5,
    hexagon: 6,
    heptagon: 7,
    octagon: 8,
    nonagon: 9,
    decagon: 10,
  };
  return sidesMap[polygonType] ?? 4;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
