import type { Point, Line } from "./angleClasses";

// ─────────────────────────────────────────────
// Constants — values that do NOT change
// Shared by angleClasses.ts (internal geometry logic) and angleActor.ts
// (job orchestration). Lives in its own module so neither file has to
// import the other just to reach a constant — angleClasses.ts already
// exports the classes that angleActor.ts consumes, so pushing constants
// into angleActor.ts and importing them back from angleClasses.ts would
// create a cycle. This file sits below both.
// ─────────────────────────────────────────────

export const lettersArray = "CDEFGHIJKLMNPQRSTUWXYZ".split(""); // excludes A, B, O, V
export const knownAngles = [360, 270, 180, 120, 90, 60, 45, 30, 15];
export const arcRadius = 15; // mm, used to draw an arc
export const rayLength = 60; // mm
export const paperSize: [Point, Point] = [
  [0, 210], // x1, x2
  [0, 297], // y1, y2
];
export const border: [number, number, number, number] = [10, 10, 200, 287]; // paperSize inset by 10mm
export const baseLineLength = 80; // mm

export const MIN_VALID_ANGLE = 0; // exclusive
// Angle jobs support all four quadrants.  Keep this exclusive so 360°
// remains equivalent to 0° and is not treated as a constructible request.
export const MAX_VALID_ANGLE = 360;

export const QUADRANT_BOUNDS: Record<1 | 2 | 3 | 4, [number, number]> = {
  1: [0, 90],
  2: [90, 180],
  3: [180, 270],
  4: [270, 360],
};

export const QUADRANT_REFERENCE_LINE: Record<1 | 2 | 3 | 4, Line> = {
  1: ["O", "Vup"],
  2: ["O", "A"],
  3: ["O", "Vdown"],
  4: ["O", "A"],
};

export const COMPLEXITY_MAP: Record<number, number> = {
  360: 0,
  270: 3,
  180: 1,
  120: 4,
  90: 2,
  60: 1,
  45: 1,
  30: 1,
  15: 2,
};

export const REMAINDER_COST = 1;
export const STEP_MM = 10;
export const BASE_CONSTRUCTABLE_ANGLES = [120, 90, 60];

// Rotation direction for sweeping a reference arc, by quadrant.
// Q1/Q2/Q3 sweep CCW, Q4 sweeps CW. World frame origin is bottom-left,
// so y increases upward — increasing theta (atan2/cos/sin) is visually
// CCW, matching standard math convention (not paper/screen convention).
export const QUADRANT_SWEEP_DIRECTION: Record<1 | 2 | 3 | 4, "cw" | "ccw"> = {
  1: "ccw",
  2: "ccw",
  3: "ccw",
  4: "cw",
};

// Sweep angle (degrees) for each target angle's from-scratch base-arc
// reference mark. Purely visual/indicative — the real cut point is found
// independently via circle-circle intersection in bisectArc, so this
// doesn't need to reach the target angle itself.
export const ANGLE_SWEEP: Record<60 | 90 | 120, number> = {
  60: 90,
  90: 120,
  120: 135,
};
