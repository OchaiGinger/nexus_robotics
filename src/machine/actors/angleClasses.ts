import {
  lettersArray,
  knownAngles,
  border,
  QUADRANT_BOUNDS,
  QUADRANT_REFERENCE_LINE,
  COMPLEXITY_MAP,
  REMAINDER_COST,
  STEP_MM,
  BASE_CONSTRUCTABLE_ANGLES,
  QUADRANT_SWEEP_DIRECTION,
  ANGLE_SWEEP,
} from "./constants";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type Point = [number, number];
export type Line = [string, string]; // [startLetter, endLetter]

export type DrawTask = "ray" | "horizontal" | "vertical" | "arc" | "measure" | "mark";

export type DrawInstruction = {
  task: DrawTask;
  start: Point;
  end: Point;
  value: number;
  center?: Point;
  label?: string;
  labels?: [string, string]; // exact per-point letters — use this, not label.split()
  radius?: number;
};

// ─────────────────────────────────────────────
// Global state — values that CHANGE during a run
// ─────────────────────────────────────────────

export let currentQuadrant: 1 | 2 | 3 | 4 = 1;
export let origin: Point = [0, 0];
export let nextAvailableLetter = 0;
export let fullTaskList: DrawInstruction[] = [];
export let dataStore: Record<string, Point> = {};

// Constants (lettersArray, knownAngles, arcRadius, rayLength, paperSize,
// border, baseLineLength, QUADRANT_BOUNDS, QUADRANT_REFERENCE_LINE,
// COMPLEXITY_MAP, REMAINDER_COST, STEP_MM, BASE_CONSTRUCTABLE_ANGLES,
// QUADRANT_SWEEP_DIRECTION, ANGLE_SWEEP, MIN/MAX_VALID_ANGLE) now live in
// ./constants — imported above, only what's actually used here.

// ─────────────────────────────────────────────
// Shared lookups — used by both Helpers and Draws
// ─────────────────────────────────────────────

/**
 * Looks up a point's [x, y] by its letter in dataStore. Any function
 * that receives a point as an argument should take the letter and
 * resolve it through here rather than accepting raw x/y — dataStore is
 * the source of truth, not the (mutable) global `origin`.
 */
function resolvePoint(letter: string): Point {
  const point = dataStore[letter];
  if (!point) {
    throw new Error(`resolvePoint: no point found in dataStore for letter "${letter}"`);
  }
  return point;
}

/**
 * Resolves both endpoints of a Line (a pair of letters) through
 * resolvePoint/dataStore.
 */
function resolveLine(line: Line): [Point, Point] {
  const [startLetter, endLetter] = line;
  return [resolvePoint(startLetter), resolvePoint(endLetter)];
}

/** Straight-line distance between two points, in mm. */
function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Assigns letters to new points and stores them in dataStore. For each
 * [x, y] in `points`, picks the next letter from lettersArray at index
 * nextAvailableLetter, writes dataStore[letter] = [x, y], then increments
 * nextAvailableLetter. Returns the assigned letters, same order as input.
 */
function updateDataStore(points: Point[]): string[] {
  const assignedLetters: string[] = [];

  for (const point of points) {
    if (nextAvailableLetter >= lettersArray.length) {
      throw new Error("updateDataStore: ran out of letters in lettersArray");
    }

    const letter = lettersArray[nextAvailableLetter];
    dataStore[letter] = point;
    nextAvailableLetter++;
    assignedLetters.push(letter);
  }

  return assignedLetters;
}

// ─────────────────────────────────────────────
// Classes
// ─────────────────────────────────────────────

export class Helpers {
  private memo = new Map<
    number,
    { angles: number[]; remainder: number; complexity: number; steps: number }
  >();

  getQuadrant(angleDegrees: number): 1 | 2 | 3 | 4 {
    if (angleDegrees >= 0 && angleDegrees <= 90) return 1;
    if (angleDegrees > 90 && angleDegrees <= 180) return 2;
    if (angleDegrees > 180 && angleDegrees <= 270) return 3;
    return 4;
  }

  /**
   * Public passthrough to the module-private resolvePoint/dataStore
   * lookup. Lets other classes (e.g. Construct) read a point's raw [x, y]
   * without duplicating dataStore access logic.
   */
  getPoint(letter: string): Point {
    return resolvePoint(letter);
  }

  private buildFromKnownAngles(target: number): {
    angles: number[];
    remainder: number;
    complexity: number;
    steps: number;
  } {
    const cached = this.memo.get(target);
    if (cached) return cached;

    const smallestKnown = knownAngles[knownAngles.length - 1];

    if (target < smallestKnown) {
      const result = {
        angles: [],
        remainder: target,
        complexity: target === 0 ? 0 : REMAINDER_COST,
        steps: target === 0 ? 0 : 1,
      };
      this.memo.set(target, result);
      return result;
    }

    let best: { angles: number[]; remainder: number; complexity: number; steps: number } | null = null;

    for (const ka of knownAngles) {
      if (ka > target) continue;
      const sub = this.buildFromKnownAngles(target - ka);
      const complexity = COMPLEXITY_MAP[ka] + sub.complexity;
      const steps = 1 + sub.steps;

      const isBetter =
        !best ||
        complexity < best.complexity ||
        (complexity === best.complexity && steps < best.steps);

      if (isBetter) {
        best = {
          angles: [ka, ...sub.angles],
          remainder: sub.remainder,
          complexity,
          steps,
        };
      }
    }

    const result = best ?? {
      angles: [],
      remainder: target,
      complexity: REMAINDER_COST,
      steps: 1,
    };
    this.memo.set(target, result);
    return result;
  }

  decompose(angleDegrees: number): {
    quadrant: 1 | 2 | 3 | 4;
    reference: "raw" | "lowerBound" | "upperBound";
    angles: number[];
    remainder: number;
  } {
    const quadrant = this.getQuadrant(angleDegrees);

    if (quadrant === 1 || quadrant === 2) {
      const { angles, remainder } = this.buildFromKnownAngles(angleDegrees);
      return { quadrant, reference: "raw", angles, remainder };
    }

    const [lowerBound, upperBound] = QUADRANT_BOUNDS[quadrant];
    const diffFromLower = angleDegrees - lowerBound;
    const diffFromUpper = upperBound - angleDegrees;

    const fromLower = this.buildFromKnownAngles(diffFromLower);
    const fromUpper = this.buildFromKnownAngles(diffFromUpper);

    const upperIsBetter =
      fromUpper.complexity < fromLower.complexity ||
      (fromUpper.complexity === fromLower.complexity && fromUpper.steps < fromLower.steps);

    if (upperIsBetter) {
      return { quadrant, reference: "upperBound", angles: fromUpper.angles, remainder: fromUpper.remainder };
    }

    return { quadrant, reference: "lowerBound", angles: fromLower.angles, remainder: fromLower.remainder };
  }

  recompose(target: number): number[] {
    const chain: number[] = [target];
    let current = target;

    while (!BASE_CONSTRUCTABLE_ANGLES.includes(current)) {
      current = current * 2;
      chain.unshift(current);
    }

    return chain;
  }

  lastDrawnRemainder(
    _quadrant: 1 | 2 | 3 | 4,
    drawnAngle: number,
    axes: [Line, Line]
  ): { remainderAngle: number; lines: [Line, Line] } {
    const [line1, line2] = axes;

    resolveLine(line1);
    resolveLine(line2);

    // The two supplied lines already bound the angle just constructed:
    // `line1` is the fixed reference edge and `line2` is the newest ray.
    // A later recompose item is reached by repeatedly halving that angle,
    // so replacing either line with a quadrant axis here loses the actual
    // construction state (and makes 90° -> 45° appear to have a 0° gap).
    return { remainderAngle: drawnAngle, lines: [line1, line2] };
  }

  arcLength(radius: number, angle: number): number {
    return ((angle * Math.PI) / 180) * radius;
  }

  distancePoint(
    axes: Line,
    radius: number,
    symbol: "add" | "sub",
    stepMm: number = STEP_MM,
  ): Point {
    const [pointLetter, centerLetter] = axes;
    const [pointX, pointY] = resolvePoint(pointLetter);
    const [centerX, centerY] = resolvePoint(centerLetter);

    const theta = Math.atan2(pointY - centerY, pointX - centerX);

    const deltaAngleRad = stepMm / radius;
    const newTheta = symbol === "add" ? theta + deltaAngleRad : theta - deltaAngleRad;

    const newX = centerX + radius * Math.cos(newTheta);
    const newY = centerY + radius * Math.sin(newTheta);

    return [newX, newY];
  }

  updateDataStore(points: Point[]): string[] {
    return updateDataStore(points);
  }

  /**
   * Updates the module-level `currentQuadrant` state. `currentQuadrant`
   * is an exported `let`, so only code inside this module can reassign
   * it — an importer like angleActor.ts can't write to it directly, only
   * through this setter. Called once per job during initialization,
   * right after getQuadrant has determined which quadrant the requested
   * angle falls in.
   */
  setQuadrant(quadrant: 1 | 2 | 3 | 4): void {
    currentQuadrant = quadrant;
  }

  /**
   * Updates the module-level `origin` state (raw world-frame [x, y]).
   * Same reassignment restriction as setQuadrant. Distinct from
   * dataStore["O"] — callers that also want the origin addressable by
   * letter (for resolvePoint/resolveLine) should pair this with
   * setReservedPoints({ O: point, ... }).
   */
  setOrigin(point: Point): void {
    origin = point;
  }

  /**
   * Writes points directly into dataStore under caller-chosen letters,
   * bypassing the lettersArray/nextAvailableLetter auto-assignment that
   * updateDataStore uses. Meant for the small, fixed set of reserved
   * letters (O, A, B, Vup, Vdown) that lettersArray deliberately excludes
   * — general construction points should still go through
   * updateDataStore so they get sequential, non-colliding letters.
   */
  setReservedPoints(points: Record<string, Point>): void {
    for (const [letter, point] of Object.entries(points)) {
      dataStore[letter] = point;
    }
  }

  /**
   * Resets all per-job mutable state — dataStore, fullTaskList, and
   * nextAvailableLetter — back to a clean slate. initializeAngleJob calls
   * this before seeding anything, so each job starts fresh rather than
   * inheriting leftover points or drawn instructions from whichever job
   * ran before it (module state persists across calls otherwise, since
   * it isn't scoped per-job).
   */
  resetState(): void {
    for (const key of Object.keys(dataStore)) {
      delete dataStore[key];
    }
    fullTaskList.length = 0;
    nextAvailableLetter = 0;
  }
}

// ─────────────────────────────────────────────
// Draws
// ─────────────────────────────────────────────

export class Draws {
  /** Appends an instruction to the global task list (fullTaskList). */
  private pushInstruction(instr: DrawInstruction): void {
    fullTaskList.push(instr);
  }

  /**
   * Logs a ray between two already-known points. axes = [startLetter, endLetter].
   * Returns the ray's length (mm).
   */
drawRay(axes: Line): number {
  const [start, end] = resolveLine(axes);
  const length = distanceBetween(start, end);
  this.pushInstruction({ task: "ray", start, end, value: length, label: axes.join(""), labels: axes });
  return length;
}

  /**
   * Logs a horizontal construction line between two already-known points
   * (e.g. the baseline A-B). axes = [startLetter, endLetter].
   * Returns the line's length (mm).
   */
drawHorizontal(axes: Line): number {
  const [start, end] = resolveLine(axes);
  const length = distanceBetween(start, end);
  this.pushInstruction({ task: "horizontal", start, end, value: length, label: axes.join(""), labels: axes });
  return length;
}

  /**
   * Logs a vertical construction line between two already-known points
   * (e.g. O to Vup/Vdown). axes = [startLetter, endLetter].
   * Returns the line's length (mm).
   */
 drawVertical(axes: Line): number {
  const [start, end] = resolveLine(axes);
  const length = distanceBetween(start, end);
  this.pushInstruction({ task: "vertical", start, end, value: length, label: axes.join(""), labels: axes });
  return length;
}

  /**
   * Logs an arc between two already-known points (axes), centered at
   * pinLocation (letter), with the given radius. Computes the angle the
   * arc subtends at the pin. Returns that angle (deg).
   */
  drawArc(axes: Line, radius: number, pinLocation: string): number {
    const [start, end] = resolveLine(axes);
    const [pinX, pinY] = resolvePoint(pinLocation);

    const angle1 = Math.atan2(start[1] - pinY, start[0] - pinX);
    const angle2 = Math.atan2(end[1] - pinY, end[0] - pinX);

    let angleDeg = Math.abs((angle2 - angle1) * (180 / Math.PI));
    if (angleDeg > 180) angleDeg = 360 - angleDeg;

this.pushInstruction({
    task: "arc", start, end, value: angleDeg, center: resolvePoint(pinLocation),
    label: axes.join(""), labels: axes, radius,
  });
  return angleDeg
  }

  /**
   * Logs a compass-measurement step between two already-known points.
   * Functionally the same distance calculation as drawRay/drawHorizontal,
   * but semantically distinct — this is the "measure with a compass" step.
   * axes = [startLetter, endLetter]. Returns the measured distance (mm).
   */
drawMeasure(axes: Line): void {
  const [start, end] = resolveLine(axes);
  this.pushInstruction({ task: "measure", start, end, value: 0, label: axes.join(""), labels: axes });
}

  /**
   * Logs marking a single already-known point (e.g. marking O).
   * axes = pointLetter. Returns 0 (no length/angle involved).
   */
  drawMark(axes: string): number {
    const point = resolvePoint(axes);

    this.pushInstruction({ task: "mark", start: point, end: point, value: 0, label: axes });
    return 0;
  }
}

export class Special {
  constructor(private draws: Draws, private helpers: Helpers) {}

  /** Walks `distance` mm from `origin` along `axes`, toward the other endpoint. */
  private walkAlongLine(axes: Line, origin: string, distance: number): Point {
    const otherLetter = axes[0] === origin ? axes[1] : axes[0];
    const [originX, originY] = resolvePoint(origin);
    const [otherX, otherY] = resolvePoint(otherLetter);

    const dx = otherX - originX;
    const dy = otherY - originY;
    const len = Math.hypot(dx, dy);
    const unitX = dx / len;
    const unitY = dy / len;

    return [originX + distance * unitX, originY + distance * unitY];
  }

  /** True if axes is a horizontal line (x differs, y constant). */
  private isHorizontal(axes: Line): boolean {
    const [[x1, y1], [x2, y2]] = resolveLine(axes);
    return x1 !== x2 && y1 === y2;
  }

  /**
   * Marks the point `radius` mm from `origin` along `mainAxes`, swings a
   * radius-mm arc around it, and returns [frontLetter, backLetter] on
   * that arc.
   *
   * If `counterpartAxes` is given (normal two-line bisect), front/back is
   * decided by which direction moves closer to the counterpart's marked
   * point. If omitted (single-line bisect — mainAxes is horizontal or
   * vertical, no angle), front/back is decided against the nearer parallel
   * border edge instead. ASSUMPTION: "nearer edge" = whichever of the two
   * parallel border edges the point currently sits closer to — flag if a
   * fixed edge (not nearest) was intended.
   *
   * If `angle !== 0`, front overshoots the true midpoint by
   * arcLength(radius, angle) / 2 + STEP_MM (intersection() steps back
   * STEP_MM later to land on the real bisecting point); back is a plain
   * STEP_MM step. Returns [frontLetter, backLetter].
   */
  private bisectLine(
    mainAxes: Line,
    counterpartAxes: Line | undefined,
    radius: number,
    origin: string,
    angle: number
  ): Line {
    const arcLen = angle !== 0 ? this.helpers.arcLength(radius, angle) : 0;

    const mainPoint = this.walkAlongLine(mainAxes, origin, radius);
    const [mainLetter] = updateDataStore([mainPoint]);
    this.draws.drawMark(mainLetter);

    const nudged = this.helpers.distancePoint([mainLetter, origin], radius, "add", STEP_MM);

    let frontSymbol: "add" | "sub";

    if (counterpartAxes) {
      const otherPoint = this.walkAlongLine(counterpartAxes, origin, radius);
      const [otherLetter] = updateDataStore([otherPoint]);
      this.draws.drawMark(otherLetter);

      const distBefore = distanceBetween(mainPoint, otherPoint);
      const distAfter = distanceBetween(nudged, otherPoint);

      frontSymbol = distAfter < distBefore ? "add" : "sub";
    } else {
      const horizontal = this.isHorizontal(mainAxes);
      const referencePoint: Point = horizontal
        ? [
            Math.abs(mainPoint[0] - border[0]) <= Math.abs(mainPoint[0] - border[2])
              ? border[0]
              : border[2],
            mainPoint[1],
          ]
        : [
            mainPoint[0],
            Math.abs(mainPoint[1] - border[1]) <= Math.abs(mainPoint[1] - border[3])
              ? border[1]
              : border[3],
          ];

      const distBefore = distanceBetween(mainPoint, referencePoint);
      const distAfter = distanceBetween(nudged, referencePoint);

      frontSymbol = distAfter < distBefore ? "add" : "sub";
    }

    const backSymbol: "add" | "sub" = frontSymbol === "add" ? "sub" : "add";

    const backPoint = this.helpers.distancePoint([mainLetter, origin], radius, backSymbol, STEP_MM);
    const frontPoint = this.helpers.distancePoint(
      [mainLetter, origin],
      radius,
      frontSymbol,
      arcLen / 2 + STEP_MM
    );

    const [backLetter] = updateDataStore([backPoint]);
    const [frontLetter] = updateDataStore([frontPoint]);

    this.draws.drawArc([frontLetter, backLetter], radius, origin);

    return [frontLetter, backLetter];
  }

  /**
   * Reconciles the two bisectLine results into the true bisecting point.
   * Each result's front letter overshot the midpoint by STEP_MM, so
   * stepping back STEP_MM from each front point should land both arcs on
   * (approximately) the same spot — averaged here for precision, then
   * stored as a new point.
   */
  private intersection(resultA: Line, resultB: Line, radius: number, origin: string): string {
    const [frontA] = resultA;
    const [frontB] = resultB;

    const midFromA = this.helpers.distancePoint([frontA, origin], radius, "sub", STEP_MM);
    const midFromB = this.helpers.distancePoint([frontB, origin], radius, "sub", STEP_MM);

    const midpoint: Point = [(midFromA[0] + midFromB[0]) / 2, (midFromA[1] + midFromB[1]) / 2];

    const [midpointLetter] = updateDataStore([midpoint]);
    return midpointLetter;
  }

  /**
   * Bisects the angle formed by axes[0] and axes[1] (when both are given),
   * or bisects a single horizontal/vertical line against the border (when
   * only axes[0] is given — no angle).
   *
   * 1. axes[0]'s length, halved -> radius.
   * 2. Two-line case: calls bisectLine twice, swapping main/counterpart
   *    each time, then intersection() reconciles both results into the
   *    true bisecting point.
   *    Single-line case: calls bisectLine once (no counterpart) and uses
   *    its front point directly — ASSUMPTION: no second arc to reconcile
   *    against here, flag if that's wrong.
   * 3. drawRay([origin, midpointLetter]) logs the bisecting ray.
   */
  bisect(axes: Line[], angle: number, origin: string): { intersectionLetter: string; rayLength: number } {
    const mainLine = axes[0];
    const counterpartLine = axes.length > 1 ? axes[1] : undefined;

    const [start, end] = resolveLine(mainLine);
    const radius = distanceBetween(start, end) / 2;

    let midpointLetter: string;

    if (counterpartLine) {
      const resultA = this.bisectLine(mainLine, counterpartLine, radius, origin, angle);
      const resultB = this.bisectLine(counterpartLine, mainLine, radius, origin, angle);
      midpointLetter = this.intersection(resultA, resultB, radius, origin);
    } else {
      const [frontLetter] = this.bisectLine(mainLine, undefined, radius, origin, angle);
      midpointLetter = frontLetter;
    }

    const rayLength = this.draws.drawRay([origin, midpointLetter]);

    return { intersectionLetter: midpointLetter, rayLength };
  }

  /**
   * Standard two-circle intersection: circle centered at `centerA` with
   * `radiusA`, circle centered at `centerB` with `radiusB`. Returns both
   * candidate points (unordered).
   */
  private circleIntersection(
    centerA: Point,
    radiusA: number,
    centerB: Point,
    radiusB: number
  ): [Point, Point] {
    const [ax, ay] = centerA;
    const [bx, by] = centerB;
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);

    if (d === 0 || d > radiusA + radiusB || d < Math.abs(radiusA - radiusB)) {
      throw new Error("circleIntersection: circles do not intersect at the given radii");
    }

    const a = (radiusA * radiusA - radiusB * radiusB + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(radiusA * radiusA - a * a, 0));

    const midX = ax + (dx * a) / d;
    const midY = ay + (dy * a) / d;

    const perpX = -dy / d;
    const perpY = dx / d;

    const candidate1: Point = [midX + h * perpX, midY + h * perpY];
    const candidate2: Point = [midX - h * perpX, midY - h * perpY];

    return [candidate1, candidate2];
  }

  /**
   * Picks whichever of the two candidates sits `direction` (cw/ccw) of
   * `referencePoint`, both measured as angles around `center`.
   */
  private pickByDirection(
    candidates: [Point, Point],
    center: Point,
    referencePoint: Point,
    direction: "cw" | "ccw"
  ): Point {
    const refAngle = Math.atan2(referencePoint[1] - center[1], referencePoint[0] - center[0]);

    const angleDiff = (candidate: Point): number => {
      const angle = Math.atan2(candidate[1] - center[1], candidate[0] - center[0]);
      let diff = angle - refAngle;
      while (diff <= -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      return diff;
    };

    const [c1, c2] = candidates;
    const diff1 = angleDiff(c1);

    if (direction === "ccw") {
      return diff1 > 0 ? c1 : c2;
    }
    return diff1 < 0 ? c1 : c2;
  }

  /**
   * Bisects a base arc (radius baseArcRadius, centered at pinpoint,
   * running through axes[0]/axes[1]) using a compass width of
   * bisectRadius.
   *
   * 1. Circle A: center pinpoint, radius baseArcRadius (the base arc).
   *    Circle B: center axes[0] (the base arc's start point), radius
   *    bisectRadius. Their intersection gives two candidate cut points;
   *    `direction` (cw/ccw, relative to axes[0] around pinpoint) picks one.
   * 2. updateDataStore + drawMark the chosen cut point.
   * 3. Loop twice (add/sub): distancePoint([cutLetter, pinpoint],
   *    baseArcRadius, symbol, STEP_MM) nudges 10mm around the base arc on
   *    either side of the cut point. updateDataStore + drawMark each —
   *    first ("add") is the tick's start, second ("sub") is its end.
   * 4. drawArc([startLetter, endLetter], baseArcRadius, pinpoint).
   * 5. Returns the TRUE cut point's letter alongside the flanking tick
   *    letters. Callers that need the exact geometric point (e.g. a
   *    precise final ray, or pivoting a second stacked bisectArc call)
   *    must use `cutLetter`, not the ticks — the ticks are offset by
   *    STEP_MM (an *angular* offset of STEP_MM/baseArcRadius radians)
   *    and are only meant as the visual compass-scratch marks flanking
   *    the real point.
   */
  bisectArc(
    baseArcRadius: number,
    bisectRadius: number,
    axes: Line,
    direction: "cw" | "ccw",
    pinpoint: string
  ): { cutLetter: string; ticks: Line } {
    const [startLetter] = axes;
    const center = resolvePoint(pinpoint);
    const startPoint = resolvePoint(startLetter);

    const candidates = this.circleIntersection(center, baseArcRadius, startPoint, bisectRadius);
    const cutPoint = this.pickByDirection(candidates, center, startPoint, direction);

    const [cutLetter] = updateDataStore([cutPoint]);
    this.draws.drawMark(cutLetter);

    const tickLetters: string[] = [];
    for (const symbol of ["add", "sub"] as const) {
      const tickPoint = this.helpers.distancePoint([cutLetter, pinpoint], baseArcRadius, symbol, STEP_MM);
      const [tickLetter] = updateDataStore([tickPoint]);
      this.draws.drawMark(tickLetter);
      tickLetters.push(tickLetter);
    }

    const [tickStartLetter, tickEndLetter] = tickLetters;
    this.draws.drawArc([tickStartLetter, tickEndLetter], baseArcRadius, pinpoint);

    return { cutLetter, ticks: [tickStartLetter, tickEndLetter] };
  }

  /**
   * Finds where two independently-positioned circles cross: one centered
   * at `letterA` (radius radiusA), one at `letterB` (radius radiusB).
   * Picks whichever candidate lies in `direction` (cw/ccw) around
   * `letterA`, relative to `letterB` — same picking convention as
   * bisectArc, but generalized: neither circle needs to be centered at
   * the construction's vertex/pinpoint. Used by constructions (e.g.
   * construct90) where both circles are centered on baseline endpoints
   * instead. Marks and stores the chosen point, returns its letter.
   */
  circleCut(letterA: string, radiusA: number, letterB: string, radiusB: number, direction: "cw" | "ccw"): string {
    const centerA = resolvePoint(letterA);
    const centerB = resolvePoint(letterB);

    const candidates = this.circleIntersection(centerA, radiusA, centerB, radiusB);
    const chosen = this.pickByDirection(candidates, centerA, centerB, direction);

    const [letter] = updateDataStore([chosen]);
    this.draws.drawMark(letter);
    return letter;
  }
}

/**
 * Shared parameter shape for the per-angle construct functions. Not every
 * angle constructor needs every field, but keeping one shape lets
 * construct(angle, params) dispatch to whichever one matches without the
 * caller needing to know each function's individual signature.
 */
export type ConstructParams = {
  baseArcRadius: number;
  bisectRadius: number;
  axes: Line;
  direction: "cw" | "ccw";
  pinpoint: string;
};

export class Construct {
  helpers: Helpers;
  draws: Draws;
  special: Special;

  /** Maps each base-constructable angle to its dedicated construct function. */
  angleConstructors: Record<number, (params: ConstructParams) => Line>;

  constructor() {
    this.helpers = new Helpers();
    this.draws = new Draws();
    this.special = new Special(this.draws, this.helpers);

    this.angleConstructors = {
      60: this.construct60.bind(this),
      90: this.construct90.bind(this),
      120: this.construct120.bind(this),
    };
  }

  /**
   * Single entry point: construct(60, params) dynamically dispatches to
   * construct60 (or 90/120), passing params straight through. Callers
   * never need to know the individual construct60/90/120 signatures.
   */
  construct(angle: number, params: ConstructParams): Line {
    const fn = this.angleConstructors[angle];
    if (!fn) {
      throw new Error(`construct: no constructor registered for angle ${angle}`);
    }
    return fn(params);
  }

  /**
   * Sweeps a new point around `pinpoint` from `startLetter`, at the same
   * radius, by `sweepAngleDeg` degrees. Direction can be given either as
   * a quadrant (looked up via QUADRANT_SWEEP_DIRECTION — CCW = "add",
   * CW = "sub", since y increases upward here) or as an explicit "cw"/
   * "ccw", bypassing the quadrant lookup entirely — needed for
   * constructions like construct90 where a given arc's direction doesn't
   * follow the ambient quadrant's default. Computed directly from
   * degrees -> radians, no distancePoint/arcLength round trip needed
   * since the angle is already known. Marks the new point and returns
   * its letter.
   */
  private sweepArcEndpoint(
    startLetter: string,
    pinpoint: string,
    radius: number,
    quadrantOrDirection: 1 | 2 | 3 | 4 | "cw" | "ccw",
    sweepAngleDeg: number
  ): string {
    const resolvedDirection: "cw" | "ccw" =
      quadrantOrDirection === "cw" || quadrantOrDirection === "ccw"
        ? quadrantOrDirection
        : QUADRANT_SWEEP_DIRECTION[quadrantOrDirection];

    const symbol: "add" | "sub" = resolvedDirection === "ccw" ? "add" : "sub";

    const [startX, startY] = resolvePoint(startLetter);
    const [pinX, pinY] = resolvePoint(pinpoint);

    const theta = Math.atan2(startY - pinY, startX - pinX);
    const deltaRad = (sweepAngleDeg * Math.PI) / 180;
    const newTheta = symbol === "add" ? theta + deltaRad : theta - deltaRad;

    const endPoint: Point = [pinX + radius * Math.cos(newTheta), pinY + radius * Math.sin(newTheta)];
    const [endLetter] = updateDataStore([endPoint]);

    return endLetter;
  }

private construct60(params: ConstructParams): Line {
  const { baseArcRadius, bisectRadius, axes, direction, pinpoint } = params;

  this.draws.drawHorizontal(["B", "A"]);
  const verticalEndpoint = currentQuadrant === 3 || currentQuadrant === 4 ? "Vdown" : "Vup";
  this.draws.drawVertical([pinpoint, verticalEndpoint]);

  const startLetter = axes[1];
  const endLetter = this.sweepArcEndpoint(startLetter, pinpoint, baseArcRadius, currentQuadrant, ANGLE_SWEEP[60]);
  this.draws.drawArc([startLetter, endLetter], baseArcRadius, pinpoint);

  const { cutLetter, ticks } = this.special.bisectArc(baseArcRadius, bisectRadius, axes, direction, pinpoint);
  this.draws.drawRay([pinpoint, cutLetter]);

  return ticks;
}

  private construct90(params: ConstructParams): Line {
    const { pinpoint } = params;
    const verticalEndpoint = currentQuadrant === 3 || currentQuadrant === 4 ? "Vdown" : "Vup";

    this.draws.drawHorizontal(["B", "A"]);
    this.draws.drawVertical([pinpoint, verticalEndpoint]);
    return [pinpoint, verticalEndpoint];

    /*
    // A 90° construction needs the two distinct endpoints of the
    // baseline as its equal-radius circle centers.  The actor's `axes`
    // may intentionally contain the same point for a 60°/120° pivot, so
    // do not reuse it here.
    const B = "B";
    const A = "A";

    // 1. Log the baseline through the center.
    this.draws.drawHorizontal([B, A]);

    const sweep = ANGLE_SWEEP[120];

    // 2. Arc 1: from B, quadrant 1 (default ccw).
    const arc1End = this.sweepArcEndpoint(B, pinpoint, baseArcRadius, 1, sweep);
    this.draws.drawArc([B, arc1End], baseArcRadius, pinpoint);

    // 3. Arc 2: from A, direction forced CW (not quadrant-derived).
    const arc2End = this.sweepArcEndpoint(A, pinpoint, baseArcRadius, "cw", sweep);
    this.draws.drawArc([A, arc2End], baseArcRadius, pinpoint);

    // 4. True crossing of the B-circle and A-circle -> "ending" point.
    const ending = this.special.circleCut(B, baseArcRadius, A, baseArcRadius, "cw");

    // 5. Arc 3: from A, quadrant 3 (default ccw).
    const arc3End = this.sweepArcEndpoint(A, pinpoint, baseArcRadius, 3, sweep);
    this.draws.drawArc([A, arc3End], baseArcRadius, pinpoint);

    // 6. Arc 4: from B, quadrant 4 (default cw).
    const arc4End = this.sweepArcEndpoint(B, pinpoint, baseArcRadius, 4, sweep);
    this.draws.drawArc([B, arc4End], baseArcRadius, pinpoint);

    // 7. True crossing of the A-circle and B-circle -> "starting" point.
    const starting = this.special.circleCut(A, baseArcRadius, B, baseArcRadius, "cw");

    // 8. Push both points 10mm further out along y, away from O, before
    //    drawing the ray — this baseline is horizontal, so the
    //    perpendicular through its midpoint is purely vertical, and
    //    "away from O" just means further from pinpoint's y.
    const [, pinY] = this.helpers.getPoint(pinpoint);
    const endingPoint = this.helpers.getPoint(ending);
    const startingPoint = this.helpers.getPoint(starting);

    const endingOffsetPoint: Point = [
      endingPoint[0],
      endingPoint[1] + (endingPoint[1] < pinY ? -STEP_MM : STEP_MM),
    ];
    const startingOffsetPoint: Point = [
      startingPoint[0],
      startingPoint[1] + (startingPoint[1] < pinY ? -STEP_MM : STEP_MM),
    ];

    const [endingOffsetLetter] = updateDataStore([endingOffsetPoint]);
    const [startingOffsetLetter] = updateDataStore([startingOffsetPoint]);

    // 9. Ray through the perpendicular.
    this.draws.drawRay([startingOffsetLetter, endingOffsetLetter]);

    return [startingOffsetLetter, endingOffsetLetter];
    */
  }

  private construct120(params: ConstructParams): Line {
    const { baseArcRadius, bisectRadius, axes, direction, pinpoint } = params;

    // 1. Log the baseline that the base arc will be swung from.
   this.draws.drawHorizontal(["B", "A"]);
const verticalEndpoint = currentQuadrant === 3 || currentQuadrant === 4 ? "Vdown" : "Vup";
this.draws.drawVertical([pinpoint, verticalEndpoint]);
    // 2. Base arc: start = axes[1] (known), end swept via ANGLE_SWEEP[120].
    const startLetter = axes[1];
    const endLetter = this.sweepArcEndpoint(
      startLetter,
      pinpoint,
      baseArcRadius,
      currentQuadrant,
      ANGLE_SWEEP[120]
    );
    this.draws.drawArc([startLetter, endLetter], baseArcRadius, pinpoint);

    // 3. First 60° cut, from the baseline (axes[0] as the compass pivot).
    const first = this.special.bisectArc(baseArcRadius, bisectRadius, axes, direction, pinpoint);

    // 4. Log the intermediate 60° ray, through the TRUE first cut point.
    this.draws.drawRay([pinpoint, first.cutLetter]);

    // 5. Second 60° cut, pivoting off the first cut's TRUE intersection
    //    point (not its tick mark) — stacks the two 60° swings to reach
    //    120° total. bisectArc only reads axes[0], so axes[1] here is
    //    unused; reusing first.cutLetter in both slots to make that
    //    explicit rather than passing a misleading placeholder.
    const secondAxes: Line = [first.cutLetter, first.cutLetter];
    const second = this.special.bisectArc(baseArcRadius, bisectRadius, secondAxes, direction, pinpoint);

    // 6. Ray from the vertex through the final 120° cut point.
    this.draws.drawRay([pinpoint, second.cutLetter]);

    return second.ticks;
  }
}
