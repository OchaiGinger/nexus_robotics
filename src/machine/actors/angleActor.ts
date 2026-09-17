import { fromPromise } from "xstate";
import { Helpers, Construct, fullTaskList } from "./angleClasses";
import type { Point, Line, DrawInstruction } from "./angleClasses";
import {
  MIN_VALID_ANGLE,
  MAX_VALID_ANGLE,
  border,
  rayLength,
  baseLineLength,
  BASE_CONSTRUCTABLE_ANGLES,
  QUADRANT_SWEEP_DIRECTION,
} from "./constants";

export type AngleJob = { id: string; payload: { label: string; angleDegrees: number } };

type AngleActorInput = {
  job: AngleJob;
};

export type Step =
  | { t: "baseline"; len: number; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" }
  | { t: "mark"; p: [number, number]; l: string; dir: "cw" | "ccw" }
  | { t: "ray"; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" }
  | { t: "arc"; r: number; deg: number; cx: number; cy: number; dir: "cw" | "ccw"; l: string; a: [number, number]; b: [number, number] }
  | { t: "bisect"; l1: string; l2: string; deg: number; type: "angle" | "line"; l: string; m: [number, number]; substeps: Step[]; dir: "cw" | "ccw" }
  | { t: "compass"; deg: number; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" };

export type DecompItem = number | `c${number}`;

export type AngleResult = {
  angle: number;
  quadrant: 1 | 2 | 3 | 4;
  gap: number;
  from: string;
  decomp: { full: DecompItem[]; gap: DecompItem[] };
  steps: Step[];
};

export type AngleActorOutput = {
  label: "done";
  jobId: string;
  agent: "angleActor";
  result: AngleResult;
};

// ─────────────────────────────────────────────
// Initialization — the entry point that kicks off a job's whole loop
// ─────────────────────────────────────────────

export type InitializedJob = {
  angleDegrees: number;
  quadrant: 1 | 2 | 3 | 4;
  origin: Point;
};

/**
 * Starts a job: validates the requested angle, resolves and stores the
 * current quadrant, positions the world-frame origin, and seeds
 * dataStore with the fixed reference points (O, A, B, Vup, Vdown) every
 * later construction step relies on. Everything downstream (decompose /
 * recompose / construct) assumes this has already run for the job.
 *
 * World frame: origin sits at the paper's bottom-left, x increases
 * right, y increases up — no negative coordinates, same as a standard
 * first-quadrant xy graph. `border` (paperSize inset by 10mm) defines
 * the actual drawable area within that frame.
 *
 * Origin placement depends on quadrant:
 * - Q1/Q2 (0-180°): the sweep only needs room ABOVE the origin, so the
 *   origin sits close to the base of the drawable area (min y).
 * - Q3/Q4 (180-360°): standard math convention puts these below the
 *   x-axis relative to the origin, so the sweep needs room both above
 *   (for the baseline/arcs) and below (for the ray itself) — the origin
 *   is centered vertically instead.
 * x is centered either way, since the baseline (B-O-A) is symmetric
 * about the origin regardless of quadrant.
 */
export function initializeAngleJob(job: AngleJob): InitializedJob {
  if (!job || !job.payload) {
    throw new Error("initializeAngleJob: job.payload is required");
  }

  const { angleDegrees } = job.payload;

  // 1. Validate — must be a real number strictly between 0 and 360
  //    (i.e. 1-359 in whole degrees; 0/360 aren't constructible angles).
  if (
    typeof angleDegrees !== "number" ||
    !Number.isFinite(angleDegrees) ||
    angleDegrees <= MIN_VALID_ANGLE ||
    angleDegrees >= MAX_VALID_ANGLE
  ) {
    throw new Error(
      `initializeAngleJob: angleDegrees must be > ${MIN_VALID_ANGLE} and < ${MAX_VALID_ANGLE}, got ${angleDegrees}`
    );
  }

  const helpers = new Helpers();

  // Clean slate for this job — don't inherit points/instructions from
  // whatever ran before.
  helpers.resetState();

  // 2. Quadrant — resolve, then push into module state.
  const quadrant = helpers.getQuadrant(angleDegrees);
  helpers.setQuadrant(quadrant);

  // 3 & 4. Origin — bottom-left world frame, x always centered, y
  //    depends on quadrant per the rule above.
  const centerX = (border[0] + border[2]) / 2;
  const baseY = border[1];
  const centerY = (border[1] + border[3]) / 2;

  const originPoint: Point =
    quadrant === 1 || quadrant === 2 ? [centerX, baseY] : [centerX, centerY];

  helpers.setOrigin(originPoint);

  // 5. Seed dataStore with the reserved reference points, all relative
  //    to origin: A/B are the baseline's right/left endpoints
  //    (0°/180° reference). ASSUMPTION: A = 0° (positive x from O) and
  //    Vup = 90° (positive y from O) — flag if the reference convention
  //    should run the other way.
  //
  //    Vup/Vdown are placed a full rayLength from origin, and origin
  //    only has that much room in ONE direction depending on quadrant
  //    (Q1/Q2 sits near the base, so only Vup fits; Q3/Q4 sits centered,
  //    which happens to give Vdown room but not a matching need for
  //    Vup — QUADRANT_REFERENCE_LINE only ever looks up Vup for Q1 and
  //    Vdown for Q3 anyway). So only the point the quadrant group
  //    actually needs gets placed; the other is simply not written this
  //    job, rather than risk landing off-page.
  const halfBase = baseLineLength / 2;
  const A: Point = [originPoint[0] + halfBase, originPoint[1]];
  const B: Point = [originPoint[0] - halfBase, originPoint[1]];

  const reservedPoints: Record<string, Point> = { O: originPoint, A, B };

  if (quadrant === 1 || quadrant === 2) {
    reservedPoints.Vup = [originPoint[0], originPoint[1] + rayLength];
  } else {
    reservedPoints.Vdown = [originPoint[0], originPoint[1] - rayLength];
  }

  helpers.setReservedPoints(reservedPoints);

  return { angleDegrees, quadrant, origin: originPoint };
}

// ─────────────────────────────────────────────
// Step mapping — fullTaskList → Step[]
// ─────────────────────────────────────────────

function mapInstructionsToSteps(
  instructions: DrawInstruction[],
  dir: "cw" | "ccw"
): Step[] {
  return instructions.map((instr): Step => {
    const start = instr.start;
    const end = instr.end;
    const label = instr.label ?? "";
    const radius = instr.radius ?? 0;
    const center = instr.center;
    const value = instr.value;

    switch (instr.task) {
      case "horizontal":
        return { t: "baseline", len: value, l: label, a: start, b: end, dir };
      case "vertical":
      case "ray":
        return { t: "ray", l: label, a: start, b: end, dir };
      case "arc":
        return {
          t: "arc",
          r: radius,
          deg: value,
          cx: center?.[0] ?? 0,
          cy: center?.[1] ?? 0,
          dir,
          l: label,
          a: start,
          b: end,
        };
      case "measure":
        return { t: "compass", deg: value, l: label, a: start, b: end, dir };
      case "mark":
        return { t: "mark", p: start, l: label, dir };
    }
  });
}

// ─────────────────────────────────────────────
// runAngleJob — full construction pipeline
// ─────────────────────────────────────────────

export function runAngleJob(job: AngleJob): AngleActorOutput {
  console.log("[angleActor] Received job:", job);

  const { angleDegrees, quadrant } = initializeAngleJob(job);

  const construct = new Construct();
  const { helpers, draws, special } = construct;
  const dir = QUADRANT_SWEEP_DIRECTION[quadrant];

  const decomposition = helpers.decompose(angleDegrees);
  // Prefer the dedicated constructor when the requested angle is itself
  // constructable. The generic complexity optimiser can express 120° as
  // 60° + 60°, but the actor's follow-up stage performs bisections, not
  // additive sweeps, so the second 60° would otherwise be a no-op.
  const task = BASE_CONSTRUCTABLE_ANGLES.includes(angleDegrees)
    ? [angleDegrees]
    : [...decomposition.angles];
  const { remainder } = decomposition;

  let lastDrawnAngle = 0;
  let axes: Line;
  let lastDrawnLines: [Line, Line];

  const pinpoint = "O";
  // A and B are the endpoints of the 80 mm baseline, with O at its
  // midpoint.  The compass constructions use those endpoints as circle
  // centers/on-arc points, so their radius must be half the baseline.
  const baseArcRadius = baseLineLength / 2;
  const bisectRadius = baseArcRadius;
  const direction: "cw" | "ccw" = dir;

  // The 60°/120° constructors use axes[0] as a compass pivot on the
  // construction circle.  Q3 starts from the 180° side (B); all other
  // quadrants start from the 0°/360° side (A).
  axes = quadrant === 3 ? ["B", "B"] : ["A", "A"];

  lastDrawnLines = [axes, axes];

  if (task.length > 0 && !BASE_CONSTRUCTABLE_ANGLES.includes(task[0])) {
    const chain = helpers.recompose(task[0]);
    task.splice(0, 1, ...chain);
  }

  try {
    for (let i = 0; i < task.length; i++) {
      if (i === 0) {
        const firstEdge = construct.construct(task[0], {
          baseArcRadius,
          bisectRadius,
          axes,
          direction,
          pinpoint,
        });
        lastDrawnLines = [axes, firstEdge];
        lastDrawnAngle = task[0];
        continue;
      }

      const { remainderAngle, lines } = helpers.lastDrawnRemainder(
        quadrant,
        lastDrawnAngle,
        lastDrawnLines
      );

      const referenceLine = lines[1];
      // target = remainder / 2^halvings.  The previous expression divided
      // by two, which gave 0.5 for the common 60° -> 30° case and skipped
      // the required bisection.
      const halvings = Math.log2(remainderAngle / task[i]);

      if (!Number.isFinite(halvings) || halvings < 0 || !Number.isInteger(halvings)) {
        draws.drawMeasure(lines[0]);
        lastDrawnLines = lines;
      } else {
        let bisectAngle = remainderAngle;
        let workingLine = lines[1];

        for (let j = 0; j < halvings; j++) {
          const { intersectionLetter } = special.bisect(
            [referenceLine, workingLine],
            bisectAngle,
            pinpoint
          );
          workingLine = [pinpoint, intersectionLetter];
          bisectAngle = bisectAngle / 2;
        }

        lastDrawnLines = [referenceLine, workingLine];
      }

      lastDrawnAngle = task[i];
    }
    } catch (e) {
    console.log("[angleActor] Construction stopped early:", e);
  }

  // Angles below the smallest known construction (or exactly on a Q3/Q4
  // reference boundary) have no base chunk.  They are represented by a
  // compass gap, but still need a stable, visible reference construction.
  if (task.length === 0) {
    draws.drawHorizontal(["B", "A"]);
    draws.drawMark(pinpoint);
  }

  // The overall decomposition remainder (the leftover angle decompose()
  // couldn't express via known constructible angles) isn't reachable by
  // straightedge/compass — log it as a measured (protractor) step from
  // the last constructed line, same convention as the mid-loop halving
  // fallback above.
  if (remainder > 0) {
    draws.drawMeasure(lastDrawnLines[1]);
  }

  const steps = mapInstructionsToSteps(fullTaskList, dir);
  const full: DecompItem[] = [...task];
  if (remainder > 0) full.push(`c${remainder}`);
  const from = task.length > 0 ? `${task[task.length - 1]}°` : "0°";

  const output: AngleActorOutput = {
    label: "done",
    jobId: job.id,
    agent: "angleActor",
    result: {
      angle: angleDegrees,
      quadrant,
      gap: remainder,
      from,
      decomp: {
        full,
        gap: remainder > 0 ? [`c${remainder}`] : [],
      },
      steps,
    },
  };

  console.log("[angleActor] Final output:", JSON.stringify(output, null, 2));

  return output;
}

// ─────────────────────────────────────────────
// Actor — connection to the state machine
// ─────────────────────────────────────────────

export const angleActor = fromPromise<AngleActorOutput, AngleActorInput>(
  async ({ input }) => {
    if (!input.job) throw new Error("angleActor requires a job");
    return runAngleJob(input.job);
  }
);
