import { z } from "zod";

export const projectionAgentPayloadSchema = z.object({
  label: z.string().default(""),
  imageDataUrl: z
    .string()
    .optional()
    .refine(
      (value) => !value || value.length <= 5_000_000,
      "Image must be smaller than 5 MB",
    ),
  imageMimeType: z.string().optional(),
  trellisModelUrl: z.string().optional(),
  trellisRenderUrl: z.string().optional(),
}).passthrough();

export const angleAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this angle a name").default(""),
  angleDegrees: z
    .number()
    .gt(0, "Must be greater than 0")
    .lt(360, "Must be less than 360"),
});

export type TriangleType = "equilateral" | "isosceles" | "scalene";

const polygonTypeSchema = z.enum([
  "triangle",
  "square",
  "rectangle",
  "pentagon",
  "hexagon",
  "heptagon",
  "octagon",
  "nonagon",
  "decagon",
]);

const triangleDimensionsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("equilateral"),
    sideLengthMm: z.number().positive("Must be greater than 0"),
  }),
  z.object({
    type: z.literal("isosceles"),
    baseLengthMm: z.number().positive("Must be greater than 0"),
    equalSideLengthMm: z.number().positive("Must be greater than 0"),
  }),
  z.object({
    type: z.literal("scalene"),
    sideAMm: z.number().positive("Must be greater than 0"),
    sideBMm: z.number().positive("Must be greater than 0"),
    sideCMm: z.number().positive("Must be greater than 0"),
  }),
]);

const regularPolygonDimensionsSchema = z.object({
  sideLengthMm: z.number().positive("Must be greater than 0"),
});

const rectangleDimensionsSchema = z.object({
  widthMm: z.number().positive("Must be greater than 0"),
  heightMm: z.number().positive("Must be greater than 0"),
});

export const polygonAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this polygon a name").default(""),
  polygonType: polygonTypeSchema,
  dimensions: z.union([
    triangleDimensionsSchema,
    rectangleDimensionsSchema,
    regularPolygonDimensionsSchema,
  ]),
});

export const gearAgentPayloadSchema = z.object({
  label: z.string().min(1, "Give this gear a name").default(""),
  module: z.number().positive("Module must be greater than 0"),
  teethCount: z.number().int().positive("Must be a positive integer"),
  pressureAngleDegrees: z
    .number()
    .positive("Must be greater than 0")
    .default(20),
  faceWidthMm: z.number().positive("Face width must be greater than 0"),
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
export type ProjectionAgentPayload = z.infer<typeof projectionAgentPayloadSchema>;
export type TriangleType = z.infer<typeof triangleTypeSchema>;
export type PolygonType = z.infer<typeof polygonTypeSchema>;
