import { fromPromise } from "xstate";

const PAPER_WIDTH = 300;
const PAPER_HEIGHT = 220;
const BORDER = 20;
const BASELINE_LEN = 120;
const ARC_RADIUS = 60;
const RAY_LEN = 150;

type AngleActorInput = {
  job: { id: string; payload: { label: string; angleDegrees: number } };
};

export type AngleActorOutput = {
  label: "done";
  jobId: string;
  agent: "angleActor";
  result: AngleResult;
};

type Quadrant = 1 | 2 | 3 | 4;
type Direction = "cw" | "ccw";
type Point = { x: number; y: number };
type DecompItem = number | `c${number}`;

type Step =
  | { t: "baseline"; len: number; l: string; dir: Direction; a: [number, number]; b: [number, number] }
  | { t: "mark"; p: [number, number]; l: string; dir: Direction }
  | { t: "ray"; l: string; dir: Direction; a: [number, number]; b: [number, number] }
  | { t: "arc"; r: number; deg: number; cx: number; cy: number; dir: Direction; l: string; a: [number, number]; b: [number, number] }
  | { t: "bisect"; l1: string; l2: string; deg: number; type: "angle" | "line"; l: string; dir: Direction; m: [number, number]; substeps: Step[] }
  | { t: "compass"; deg: number; l: string; dir: Direction; a: [number, number]; b: [number, number] };

type AngleResult = {
  angle: number;
  quadrant: Quadrant;
  gap: number;
  from: string;
  decomp: { full: DecompItem[]; gap: DecompItem[] };
  steps: Step[];
};

type BuildState = {
  vertexX: number;
  vertexY: number;
  direction: Direction;
  currentAngle: number;
  startAngle: number;
  lastPointLabel: string;
  nextMarkIndex: number;
  steps: Step[];
  rayAngles: Map<string, number>;
};

function initBuildState(originX: number, originY: number, direction: Direction): BuildState {
  return {
    vertexX: originX, vertexY: originY, direction, 
    currentAngle: 0, startAngle: 0,
    lastPointLabel: "B", nextMarkIndex: 1, 
    steps: [], rayAngles: new Map(),
  };
}

function nextLabel(state: BuildState, prefix: string): string {
  const label = `${prefix}${state.nextMarkIndex}`;
  state.nextMarkIndex++;
  return label;
}

function pointOnCircle(centerX: number, centerY: number, radius: number, angleDegrees: number): Point {
  const rad = (angleDegrees * Math.PI) / 180;
  return {
    x: Math.round(centerX + radius * Math.cos(rad)),
    y: Math.round(centerY - radius * Math.sin(rad)), // Note: y is inverted in canvas
  };
}

function quadrantOf(angleDegrees: number): Quadrant {
  const normalized = ((angleDegrees % 360) + 360) % 360;
  if (normalized <= 90) return 1;
  if (normalized <= 180) return 2;
  if (normalized <= 270) return 3;
  return 4;
}

function angleFromTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI;
}

function decomposeAngle(angle: number): DecompItem[] {
  // Simple decomposition for now
  const parts: DecompItem[] = [];
  let remaining = angle;
  
  // Try to use 120, 90, 60, 45, 30, 15
  const knownAngles = [120, 90, 60, 45, 30, 15];
  for (const known of knownAngles) {
    while (remaining >= known - 0.01) {
      parts.push(known);
      remaining -= known;
    }
  }
  if (remaining > 0.5) {
    parts.push(`c${Math.round(remaining)}` as const);
  }
  return parts;
}

function drawBaseline(state: BuildState): void {
  const { vertexX, vertexY, direction } = state;
  const left = { x: vertexX - BASELINE_LEN / 2, y: vertexY };
  const right = { x: vertexX + BASELINE_LEN / 2, y: vertexY };
  
  state.steps.push({ 
    t: "baseline", len: BASELINE_LEN, l: "AB", dir: direction, 
    a: [left.x, vertexY], b: [right.x, vertexY] 
  });
  state.steps.push({ t: "mark", p: [vertexX, vertexY], l: "O", dir: direction });
  state.steps.push({ t: "mark", p: [left.x, vertexY], l: "A", dir: direction });
  state.steps.push({ t: "mark", p: [right.x, vertexY], l: "B", dir: direction });
  
  state.lastPointLabel = "O";
  state.rayAngles.set("O", 0);
  state.rayAngles.set("A", 180);
  state.rayAngles.set("B", 0);
}

function drawVerticalLine(state: BuildState): void {
  const { vertexX, vertexY, direction } = state;
  const top = { x: vertexX, y: vertexY - BASELINE_LEN / 2 };
  const bottom = { x: vertexX, y: vertexY + BASELINE_LEN / 2 };
  
  state.steps.push({ t: "ray", l: "VU", dir: direction, a: [vertexX, vertexY], b: [top.x, top.y] });
  state.steps.push({ t: "ray", l: "VD", dir: direction, a: [vertexX, vertexY], b: [bottom.x, bottom.y] });
  state.steps.push({ t: "mark", p: [top.x, top.y], l: "VUP", dir: direction });
  state.steps.push({ t: "mark", p: [bottom.x, bottom.y], l: "VDOWN", dir: direction });
  
  state.rayAngles.set("VUP", 90);
  state.rayAngles.set("VDOWN", 270);
}

// Build 60° angle from current position
function build60(state: BuildState): string {
  const { vertexX, vertexY, direction, currentAngle } = state;
  const r = ARC_RADIUS;
  const sign = direction === "cw" ? -1 : 1;
  
  // Point on circle at current angle
  const start = pointOnCircle(vertexX, vertexY, r, currentAngle);
  // End point at currentAngle + 60°
  const end = pointOnCircle(vertexX, vertexY, r, currentAngle + sign * 60);
  // Intersection point for 60° construction
  const mid = pointOnCircle(start.x, start.y, r, currentAngle + sign * 120);
  
  const markLabel = nextLabel(state, "M");
  const arcLabel = `arc60_${state.nextMarkIndex - 1}`;
  const oppositeDir: Direction = direction === "cw" ? "ccw" : "cw";
  
  state.steps.push(
    { t: "arc", r, deg: 60, cx: vertexX, cy: vertexY, dir: direction, l: arcLabel, a: [start.x, start.y], b: [end.x, end.y] },
    { t: "arc", r, deg: 60, cx: start.x, cy: start.y, dir: oppositeDir, l: arcLabel, a: [vertexX, vertexY], b: [mid.x, mid.y] },
    { t: "mark", p: [mid.x, mid.y], l: markLabel, dir: direction },
  );
  
  state.currentAngle = currentAngle + sign * 60;
  state.lastPointLabel = markLabel;
  state.rayAngles.set(markLabel, state.currentAngle);
  
  return markLabel;
}

// Build 90° angle from current position
function build90(state: BuildState): string {
  const {
    vertexX,
    vertexY,
    direction,
    currentAngle,
  } = state;

  const r = ARC_RADIUS;
  const sign = direction === "cw" ? -1 : 1;

  // ========================================================
  // A = left end of baseline
  // B = right end of baseline
  // O = center point (vertex)
  // ========================================================

  const aPoint = { x: vertexX - r, y: vertexY };
  const bPoint = { x: vertexX + r, y: vertexY };
  const oPoint = { x: vertexX, y: vertexY };

  // ========================================================
  // INTERSECTION POINT
  // ========================================================
  //
  // Two circles of radius r centered at A and B intersect
  // at points directly above and below O.
  //
  // The distance from O to the intersection is sqrt(3) * r.
  //
  // ========================================================

  const intersectionDistance = r * Math.sqrt(3);
  const finalPoint = pointOnCircle(
    vertexX,
    vertexY,
    intersectionDistance,
    currentAngle + sign * 90
  );

  const finalLabel = nextLabel(state, "M");
  const arcLabel = `arc90_${state.nextMarkIndex - 1}`;

  // ========================================================
  // ARC 1 — From A (left end), sweeping top and bottom
  // ========================================================

  state.steps.push({
    t: "arc",
    r,
    deg: 180,

    cx: aPoint.x,
    cy: aPoint.y,

    dir: direction,

    l: `${arcLabel}_fromA`,

    a: [aPoint.x, aPoint.y - r],
    b: [finalPoint.x, finalPoint.y],
  });

  // ========================================================
  // ARC 2 — From B (right end), sweeping top and bottom
  // ========================================================

  state.steps.push({
    t: "arc",
    r,
    deg: 180,

    cx: bPoint.x,
    cy: bPoint.y,

    dir: direction,

    l: `${arcLabel}_fromB`,

    a: [bPoint.x, bPoint.y - r],
    b: [finalPoint.x, finalPoint.y],
  });

  // ========================================================
  // MARK INTERSECTION AND DRAW RAY
  // ========================================================

  state.steps.push({
    t: "mark",

    p: [finalPoint.x, finalPoint.y],

    l: finalLabel,

    dir: direction,
  });

  // ========================================================
  // UPDATE STATE
  // ========================================================

  state.currentAngle = currentAngle + sign * 90;
  state.lastPointLabel = finalLabel;
  state.rayAngles.set(finalLabel, state.currentAngle);

  return finalLabel;
}
// Build 120° angle using proper geometric construction
function build120(state: BuildState): string {
  const { vertexX, vertexY, direction, currentAngle } = state;
  const r = ARC_RADIUS;
  const sign = direction === "cw" ? -1 : 1;
  
  // B = point at 0° on baseline
  const bPoint = pointOnCircle(vertexX, vertexY, r, currentAngle);
  
  // R = 60° point on main arc (intersection of Arc 1 & Arc 2)
  const rPoint = pointOnCircle(vertexX, vertexY, r, currentAngle + sign * 60);
  
  // P = 120° point on main arc
  const pPoint = pointOnCircle(vertexX, vertexY, r, currentAngle + sign * 120);
  
  const markR = nextLabel(state, "M");
  const markP = nextLabel(state, "M");
  const arcLabel = `arc120_${state.nextMarkIndex - 2}`;
  
  // Arc 1: Main arc centered at O, from B (0°) to P (120°) CCW
  state.steps.push({
    t: "arc", 
    r, 
    deg: 120, 
    cx: vertexX, 
    cy: vertexY, 
    dir: "ccw",
    l: arcLabel, 
    a: [bPoint.x, bPoint.y], 
    b: [pPoint.x, pPoint.y]
  });
  
  // Arc 2: Centered at B (0° point), radius r, clockwise, 60°
  // Finds R (60° point) on the main arc
  state.steps.push({
    t: "arc",
    r,
    deg: 60,
    cx: bPoint.x,
    cy: bPoint.y,
    dir: "cw",
    l: arcLabel,
    a: [vertexX, vertexY],
    b: [rPoint.x, rPoint.y]
  });
  
  state.steps.push({
    t: "mark",
    p: [rPoint.x, rPoint.y],
    l: markR,
    dir: "ccw"
  });
  
  // Arc 3: Centered at R (60° point), radius r, clockwise, 60°
  // Finds P (120° point) on the main arc
  state.steps.push({
    t: "arc",
    r,
    deg: 60,  // FIXED: was 120°, now 60°
    cx: rPoint.x,
    cy: rPoint.y,
    dir: "cw",
    l: arcLabel,
    a: [bPoint.x, bPoint.y],
    b: [pPoint.x, pPoint.y]
  });
  
  state.steps.push({
    t: "mark",
    p: [pPoint.x, pPoint.y],
    l: markP,
    dir: "ccw"
  });
  
  state.currentAngle = currentAngle + sign * 120;
  state.lastPointLabel = markP;
  state.rayAngles.set(markR, currentAngle + sign * 60);
  state.rayAngles.set(markP, state.currentAngle);
  
  return markP;
}

// Build a compass remainder (simple arc swing)
function buildCompass(state: BuildState, degrees: number): string {
  const { vertexX, vertexY, direction, currentAngle } = state;
  const r = ARC_RADIUS;
  const sign = direction === "cw" ? -1 : 1;
  
  const start = pointOnCircle(vertexX, vertexY, r, currentAngle);
  const end = pointOnCircle(vertexX, vertexY, r, currentAngle + sign * degrees);
  const markLabel = nextLabel(state, "M");
  
  state.steps.push(
    { t: "arc", r, deg: degrees, cx: vertexX, cy: vertexY, dir: "ccw", l: `arc${degrees}_${state.nextMarkIndex - 1}`, a: [start.x, start.y], b: [end.x, end.y] },
    { t: "mark", p: [end.x, end.y], l: markLabel, dir: direction },
  );
  
  state.currentAngle = currentAngle + sign * degrees;
  state.lastPointLabel = markLabel;
  state.rayAngles.set(markLabel, state.currentAngle);
  
  return markLabel;
}

// Build a specific known angle
function buildAngle(state: BuildState, degrees: number): string {
  if (degrees === 60) return build60(state);
  if (degrees === 90) return build90(state);
  if (degrees === 120) return build120(state);
  if (degrees === 45) {
    // 45° = 90° bisected
    const ninetyLabel = build90(state);
    return bisectAngle(state, "O", ninetyLabel, 45);
  }
  if (degrees === 30) {
    // 30° = 60° bisected
    const sixtyLabel = build60(state);
    return bisectAngle(state, "O", sixtyLabel, 30);
  }
  if (degrees === 15) {
    // 15° = 60° bisected twice
    const sixtyLabel = build60(state);
    const thirtyLabel = bisectAngle(state, "O", sixtyLabel, 30);
    return bisectAngle(state, "O", thirtyLabel, 15);
  }
  return buildCompass(state, degrees);
}

// Bisect an angle between two rays
function bisectAngle(state: BuildState, line1Label: string, line2Label: string, targetDegrees: number): string {
  const { vertexX, vertexY, direction } = state;
  const angle1 = state.rayAngles.get(line1Label) ?? 0;
  const angle2 = state.rayAngles.get(line2Label) ?? 0;
  const midAngle = (angle1 + angle2) / 2;
  
  const r = ARC_RADIUS;
  const bisectRadius = r / 2;
  
  // Points on the arcs
  const p1 = pointOnCircle(vertexX, vertexY, r, angle1);
  const p2 = pointOnCircle(vertexX, vertexY, r, angle2);
  const pMid = pointOnCircle(vertexX, vertexY, r, midAngle);
  
  // Points for the bisection arcs (radius r/2)
  const b1 = pointOnCircle(vertexX, vertexY, bisectRadius, angle1);
  const b2 = pointOnCircle(vertexX, vertexY, bisectRadius, angle2);
  const bMid = pointOnCircle(vertexX, vertexY, bisectRadius, midAngle);
  
  const markLabel = nextLabel(state, "M");
  const substeps: Step[] = [];
  
  // Arc 1: from b1 to bMid
  substeps.push({
    t: "arc",
    r: bisectRadius,
    deg: Math.abs(midAngle - angle1),
    cx: vertexX,
    cy: vertexY,
    dir: direction,
    l: `bisect_arc_${state.nextMarkIndex}`,
    a: [b1.x, b1.y],
    b: [bMid.x, bMid.y],
  });
  
  // Arc 2: from b2 to bMid
  substeps.push({
    t: "arc",
    r: bisectRadius,
    deg: Math.abs(midAngle - angle2),
    cx: vertexX,
    cy: vertexY,
    dir: direction,
    l: `bisect_arc_${state.nextMarkIndex + 1}`,
    a: [b2.x, b2.y],
    b: [bMid.x, bMid.y],
  });
  
  // Mark the midpoint
  substeps.push({
    t: "mark",
    p: [pMid.x, pMid.y],
    l: markLabel,
    dir: direction,
  });
  
  // Draw the bisector ray
  const rayEnd = pointOnCircle(vertexX, vertexY, RAY_LEN, midAngle);
  substeps.push({
    t: "ray",
    l: `bisect_ray_${state.nextMarkIndex + 2}`,
    dir: direction,
    a: [vertexX, vertexY],
    b: [rayEnd.x, rayEnd.y],
  });
  
  state.steps.push({
    t: "bisect",
    l1: line1Label,
    l2: line2Label,
    deg: targetDegrees,
    type: "angle",
    l: `bisect_${state.nextMarkIndex + 3}`,
    dir: direction,
    m: [pMid.x, pMid.y],
    substeps,
  });
  
  state.currentAngle = midAngle;
  state.lastPointLabel = markLabel;
  state.rayAngles.set(markLabel, midAngle);
  
  return markLabel;
}

// Build all steps for a given angle
function buildAllSteps(originX: number, originY: number, angleDegrees: number): Step[] {
  const state = initBuildState(originX, originY, "ccw");
  const quadrant = quadrantOf(angleDegrees);
  
  // Draw baseline and vertical line
  drawBaseline(state);
  drawVerticalLine(state);
  
  // Reset to baseline for construction
  state.currentAngle = 0;
  state.startAngle = 0;
  state.lastPointLabel = "O";
  state.rayAngles.set("O", 0);
  
  // Build the angle
  const decomposition = decomposeAngle(angleDegrees);
  let accumulated = 0;
  
  for (const part of decomposition) {
    if (typeof part === "string") {
      const deg = parseFloat(part.slice(1));
      buildCompass(state, deg);
      accumulated += deg;
    } else {
      buildAngle(state, part);
      accumulated += part;
    }
  }
  
  // Draw final ray
  const end = pointOnCircle(originX, originY, RAY_LEN, state.currentAngle);
  const arcStart = pointOnCircle(originX, originY, ARC_RADIUS, state.startAngle);
  const arcEnd = pointOnCircle(originX, originY, ARC_RADIUS, state.currentAngle);
  
  state.steps.push({
    t: "arc",
    r: ARC_RADIUS,
    deg: Math.abs(state.currentAngle - state.startAngle),
    cx: originX,
    cy: originY,
    dir: "ccw",
    l: "angle_arc",
    a: [arcStart.x, arcStart.y],
    b: [arcEnd.x, arcEnd.y],
  });
  
  state.steps.push({
    t: "ray",
    l: "final",
    dir: "ccw",
    a: [originX, originY],
    b: [end.x, end.y],
  });
  
  return state.steps;
}

export const angleActor = fromPromise<AngleActorOutput, AngleActorInput>(
  async ({ input }) => {
    if (!input.job) throw new Error("angleActor requires a job");

    const { angleDegrees } = input.job.payload;
    const quadrant = quadrantOf(angleDegrees);

    const originX = PAPER_WIDTH / 2;
    const originY = PAPER_HEIGHT / 2;

    const steps = buildAllSteps(originX, originY, angleDegrees);
    
    const fullDecomposition = decomposeAngle(angleDegrees);
    const gapDecomposition = decomposeAngle(angleDegrees);

    return {
      label: "done",
      jobId: input.job.id,
      agent: "angleActor",
      result: { 
        angle: angleDegrees, 
        quadrant, 
        gap: angleDegrees, 
        from: "baseline (0°)", 
        decomp: { full: fullDecomposition, gap: gapDecomposition }, 
        steps 
      },
    };
  },
);