import { z } from "zod";

// Construction-input schemas: only the parameters a user must SPECIFY
// to fully define the shape. Anything mathematically derivable from
// these (addendum, dedendum, pitch diameter, polygon vertex
// coordinates, etc.) is intentionally left OUT — that's computed
// downstream by the relevant actor, not entered by hand.

export const projectionAgentPayloadSchema = z.object({}).passthrough();
// ^ still no spec for this one — untouched, per earlier scope decision.

export const angleAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this angle a name").default(""),
  angleDegrees: z
    .number()
    .gt(0, "Must be greater than 0")
    .lt(360, "Must be less than 360"),
});

export const gearAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this gear a name").default(""),
  module: z.number().positive("Module must be greater than 0"), // mm
  teethCount: z.number().int().positive("Must be a positive integer"),
  pressureAngleDegrees: z
    .number()
    .positive("Must be greater than 0")
    .default(20), // 20° is the standard default in gear design
  // NOTE: addendum, dedendum, pitch diameter, outside diameter are all
  // derivable from module + teethCount + pressureAngle using standard
  // gear formulas — deliberately not collected here.
});

export const polygonAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this polygon a name").default(""),
  sides: z.number().int().min(3, "A polygon needs at least 3 sides"),
  sideLengthMm: z.number().positive("Must be greater than 0"),
  // NOTE: vertex coordinates are derived from sides + sideLength (and
  // an assumed regular polygon) downstream — not entered by hand.
  // ASSUMPTION I'm making explicit: this assumes REGULAR polygons only.
  // If irregular polygons are ever needed, this schema doesn't cover it.
});

export type JobType =
  | "projectionAgent"
  | "angleAgent"
  | "gearAgent"
  | "polygonAgent";

export const schemaByType: Record<JobType, z.ZodTypeAny> = {
  projectionAgent: projectionAgentPayloadSchema,
  angleAgent: angleAgentPayloadSchema,
  gearAgent: gearAgentPayloadSchema,
  polygonAgent: polygonAgentPayloadSchema,
};

export type AngleAgentPayload = z.infer<typeof angleAgentPayloadSchema>;
export type GearAgentPayload = z.infer<typeof gearAgentPayloadSchema>;
export type PolygonAgentPayload = z.infer<typeof polygonAgentPayloadSchema>;
