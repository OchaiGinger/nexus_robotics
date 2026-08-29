"use client";

import { useState } from "react";
import { useRouter } from "next/link";
import { useNexusMachine } from "@/app/context/machine-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AngleAgentPayload,
  GearAgentPayload,
  PolygonAgentPayload,
  JobType,
  TriangleType,
  PolygonType,
} from "@/lib/schemas/job-payloads";
import { useRouter as useNextRouter } from "next/navigation";

const JOB_TYPES: {
  type: JobType;
  title: string;
  description: string;
  icon: string;
  color: string;
}[] = [
  {
    type: "angleAgent",
    title: "Angle",
    description: "Construct an angle from a target degree value",
    icon: "∠",
    color: "from-blue-500 to-indigo-600",
  },
  {
    type: "gearAgent",
    title: "Gear",
    description: "Design a spur gear with module, teeth, and pressure angle",
    icon: "⚙",
    color: "from-amber-500 to-orange-600",
  },
  {
    type: "polygonAgent",
    title: "Polygon",
    description: "Construct regular or irregular polygons",
    icon: "⬡",
    color: "from-emerald-500 to-teal-600",
  },
  {
    type: "projectionAgent",
    title: "Projection",
    description: "Project a shape onto a plane (coming soon)",
    icon: "◇",
    color: "from-purple-500 to-pink-600",
  },
];

const POLYGON_TYPES: { value: PolygonType; label: string; sides: number }[] = [
  { value: "triangle", label: "Triangle", sides: 3 },
  { value: "square", label: "Square", sides: 4 },
  { value: "rectangle", label: "Rectangle", sides: 4 },
  { value: "pentagon", label: "Pentagon", sides: 5 },
  { value: "hexagon", label: "Hexagon", sides: 6 },
  { value: "heptagon", label: "Heptagon", sides: 7 },
  { value: "octagon", label: "Octagon", sides: 8 },
  { value: "nonagon", label: "Nonagon", sides: 9 },
  { value: "decagon", label: "Decagon", sides: 10 },
];

const TRIANGLE_TYPES: { value: TriangleType; label: string }[] = [
  { value: "equilateral", label: "Equilateral (all sides equal)" },
  { value: "isosceles", label: "Isosceles (two sides equal)" },
  { value: "scalene", label: "Scalene (all sides different)" },
];

const PAPER_WIDTH_MM = 210;
const PAPER_HEIGHT_MM = 297;
const MAX_DIMENSION_MM = Math.min(PAPER_WIDTH_MM, PAPER_HEIGHT_MM);

const emptyAngle: AngleAgentPayload = { label: "", angleDegrees: NaN };
const emptyGear: GearAgentPayload = {
  label: "",
  module: NaN,
  teethCount: NaN,
  pressureAngleDegrees: 20,
  faceWidthMm: NaN,
};
const emptyPolygon: PolygonAgentPayload = {
  label: "",
  polygonType: "triangle",
  dimensions: { type: "equilateral", sideLengthMm: NaN },
};

export default function Home() {
  const { state, send } = useNexusMachine();
  const router = useNextRouter();
  const isIdle = state.matches("idle");

  const [selectedType, setSelectedType] = useState<JobType | null>(null);
  const [anglePayload, setAnglePayload] = useState(emptyAngle);
  const [gearPayload, setGearPayload] = useState(emptyGear);
  const [polygonPayload, setPolygonPayload] = useState(emptyPolygon);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForms = () => {
    setAnglePayload(emptyAngle);
    setGearPayload(emptyGear);
    setPolygonPayload(emptyPolygon);
  };

  const currentPayload = (): unknown => {
    switch (selectedType) {
      case "angleAgent":
        return anglePayload;
      case "gearAgent":
        return gearPayload;
      case "polygonAgent":
        return polygonPayload;
      default:
        return {};
    }
  };

  const handleSelect = (type: JobType) => {
    if (!isIdle) return;
    setSelectedType((prev) => (prev === type ? null : type));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!selectedType) return;
    setSubmitting(true);
    setError(null);

    const job = {
      id: `job-${Date.now()}`,
      type: selectedType,
      payload: currentPayload(),
    };

    try {
      const res = await fetch("/api/jobs/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      const result = await res.json();

      if (!result.valid) {
        setError(result.reason ?? "Validation failed");
        return;
      }

      send({ type: "new_job", job: result.job });
      setSelectedType(null);
      resetForms();
      router.push("/graph");
    } catch {
      setError("Could not reach the validation API");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePolygonTypeChange = (value: PolygonType) => {
    let dimensions: PolygonAgentPayload["dimensions"];
    if (value === "triangle") {
      dimensions = { type: "equilateral", sideLengthMm: NaN };
    } else if (value === "rectangle") {
      dimensions = { widthMm: NaN, heightMm: NaN };
    } else {
      dimensions = { sideLengthMm: NaN };
    }
    setPolygonPayload({ ...polygonPayload, polygonType: value, dimensions });
  };

  const handleTriangleTypeChange = (value: TriangleType) => {
    let dimensions: PolygonAgentPayload["dimensions"];
    if (value === "equilateral") {
      dimensions = { type: "equilateral", sideLengthMm: NaN };
    } else if (value === "isosceles") {
      dimensions = { type: "isosceles", baseLengthMm: NaN, equalSideLengthMm: NaN };
    } else {
      dimensions = { type: "scalene", sideAMm: NaN, sideBMm: NaN, sideCMm: NaN };
    }
    setPolygonPayload({ ...polygonPayload, dimensions });
  };

  const getDimValue = (key: string): number => {
    const val = (polygonPayload.dimensions as Record<string, unknown>)[key];
    return typeof val === "number" ? val : NaN;
  };

  const selectedJob = JOB_TYPES.find((j) => j.type === selectedType);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-lg font-bold text-white shadow-sm">
              N
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Nexus Robotics</h1>
              <p className="text-xs text-slate-500">Job Orchestration</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
              <span className={`inline-block h-2 w-2 rounded-full ${isIdle ? "bg-green-500" : "bg-amber-500 animate-pulse"}`} />
              {isIdle ? "Idle" : "Running"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Job type selection */}
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            Select Job Type
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {JOB_TYPES.map(({ type, title, description, icon, color }) => {
              const isSelected = selectedType === type;
              return (
                <button
                  key={type}
                  onClick={() => handleSelect(type)}
                  disabled={!isIdle}
                  className={`group relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  } ${!isIdle ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-xl text-white shadow-sm`}>
                    {icon}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">
                      {description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-xs text-white">
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Job configuration */}
        {selectedType && (
          <section className="mt-8">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${selectedJob?.color} text-lg text-white`}>
                  {selectedJob?.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    Configure {selectedJob?.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Fill in the parameters below
                  </p>
                </div>
              </div>

              <div className="mt-5">
                {selectedType === "angleAgent" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="angle-label">Label</Label>
                      <Input
                        id="angle-label"
                        placeholder="e.g. Angle A"
                        value={anglePayload.label}
                        onChange={(e) =>
                          setAnglePayload({ ...anglePayload, label: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="angle-degrees">Angle (degrees)</Label>
                      <Input
                        id="angle-degrees"
                        type="number"
                        min={1}
                        max={359}
                        placeholder="e.g. 135"
                        value={Number.isNaN(anglePayload.angleDegrees) ? "" : anglePayload.angleDegrees}
                        onChange={(e) =>
                          setAnglePayload({
                            ...anglePayload,
                            angleDegrees: parseFloat(e.target.value),
                          })
                        }
                      />
                      <p className="mt-1 text-xs text-slate-400">Range: 1° – 359°</p>
                    </div>
                  </div>
                )}

                {selectedType === "gearAgent" && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <Label htmlFor="gear-label">Label</Label>
                      <Input
                        id="gear-label"
                        placeholder="e.g. Gear 1"
                        value={gearPayload.label}
                        onChange={(e) =>
                          setGearPayload({ ...gearPayload, label: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="gear-module">Module (mm)</Label>
                      <Input
                        id="gear-module"
                        type="number"
                        step="0.1"
                        placeholder="e.g. 2"
                        value={Number.isNaN(gearPayload.module) ? "" : gearPayload.module}
                        onChange={(e) =>
                          setGearPayload({ ...gearPayload, module: parseFloat(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="gear-teeth">Teeth Count</Label>
                      <Input
                        id="gear-teeth"
                        type="number"
                        min={3}
                        placeholder="e.g. 24"
                        value={Number.isNaN(gearPayload.teethCount) ? "" : gearPayload.teethCount}
                        onChange={(e) =>
                          setGearPayload({ ...gearPayload, teethCount: parseInt(e.target.value, 10) })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="gear-pressure">Pressure Angle (°)</Label>
                      <Input
                        id="gear-pressure"
                        type="number"
                        value={gearPayload.pressureAngleDegrees}
                        onChange={(e) =>
                          setGearPayload({ ...gearPayload, pressureAngleDegrees: parseFloat(e.target.value) })
                        }
                      />
                      <p className="mt-1 text-xs text-slate-400">Standard: 20°</p>
                    </div>
                    <div>
                      <Label htmlFor="gear-face-width">Face Width (mm)</Label>
                      <Input
                        id="gear-face-width"
                        type="number"
                        placeholder="e.g. 10"
                        value={Number.isNaN(gearPayload.faceWidthMm) ? "" : gearPayload.faceWidthMm}
                        onChange={(e) =>
                          setGearPayload({ ...gearPayload, faceWidthMm: parseFloat(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                )}

                {selectedType === "polygonAgent" && (
                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="polygon-label">Label</Label>
                        <Input
                          id="polygon-label"
                          placeholder="e.g. Polygon 1"
                          value={polygonPayload.label}
                          onChange={(e) =>
                            setPolygonPayload({ ...polygonPayload, label: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Polygon Type</Label>
                        <Select value={polygonPayload.polygonType} onValueChange={handlePolygonTypeChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select polygon type" />
                          </SelectTrigger>
                          <SelectContent>
                            {POLYGON_TYPES.map((pt) => (
                              <SelectItem key={pt.value} value={pt.value}>
                                {pt.label} ({pt.sides} sides)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {polygonPayload.polygonType === "triangle" && (
                      <Accordion type="single" collapsible className="rounded-lg border border-slate-200 bg-slate-50 px-4">
                        <AccordionItem value="triangle-type" className="border-none">
                          <AccordionTrigger className="py-3 text-sm font-medium text-slate-700 hover:no-underline">
                            Triangle Subtype
                          </AccordionTrigger>
                          <AccordionContent className="pb-4">
                            <div className="space-y-4">
                              <div>
                                <Label>Select Type</Label>
                                <Select
                                  value={polygonPayload.dimensions.type}
                                  onValueChange={handleTriangleTypeChange}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select triangle type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TRIANGLE_TYPES.map((tt) => (
                                      <SelectItem key={tt.value} value={tt.value}>
                                        {tt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {polygonPayload.dimensions.type === "equilateral" && (
                                <div>
                                  <Label>Side Length (mm)</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={MAX_DIMENSION_MM}
                                    value={Number.isNaN(polygonPayload.dimensions.sideLengthMm) ? "" : polygonPayload.dimensions.sideLengthMm}
                                    onChange={(e) =>
                                      setPolygonPayload({
                                        ...polygonPayload,
                                        dimensions: { type: "equilateral", sideLengthMm: parseFloat(e.target.value) },
                                      })
                                    }
                                  />
                                </div>
                              )}

                              {polygonPayload.dimensions.type === "isosceles" && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <Label>Base (mm)</Label>
                                    <Input
                                      type="number"
                                      value={Number.isNaN(getDimValue("baseLengthMm")) ? "" : getDimValue("baseLengthMm")}
                                      onChange={(e) =>
                                        setPolygonPayload({
                                          ...polygonPayload,
                                          dimensions: { type: "isosceles", baseLengthMm: parseFloat(e.target.value), equalSideLengthMm: getDimValue("equalSideLengthMm") },
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>Equal Sides (mm)</Label>
                                    <Input
                                      type="number"
                                      value={Number.isNaN(getDimValue("equalSideLengthMm")) ? "" : getDimValue("equalSideLengthMm")}
                                      onChange={(e) =>
                                        setPolygonPayload({
                                          ...polygonPayload,
                                          dimensions: { type: "isosceles", baseLengthMm: getDimValue("baseLengthMm"), equalSideLengthMm: parseFloat(e.target.value) },
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                              )}

                              {polygonPayload.dimensions.type === "scalene" && (
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <div>
                                    <Label>Side A (mm)</Label>
                                    <Input
                                      type="number"
                                      value={Number.isNaN(getDimValue("sideAMm")) ? "" : getDimValue("sideAMm")}
                                      onChange={(e) =>
                                        setPolygonPayload({
                                          ...polygonPayload,
                                          dimensions: { type: "scalene", sideAMm: parseFloat(e.target.value), sideBMm: getDimValue("sideBMm"), sideCMm: getDimValue("sideCMm") },
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>Side B (mm)</Label>
                                    <Input
                                      type="number"
                                      value={Number.isNaN(getDimValue("sideBMm")) ? "" : getDimValue("sideBMm")}
                                      onChange={(e) =>
                                        setPolygonPayload({
                                          ...polygonPayload,
                                          dimensions: { type: "scalene", sideAMm: getDimValue("sideAMm"), sideBMm: parseFloat(e.target.value), sideCMm: getDimValue("sideCMm") },
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label>Side C (mm)</Label>
                                    <Input
                                      type="number"
                                      value={Number.isNaN(getDimValue("sideCMm")) ? "" : getDimValue("sideCMm")}
                                      onChange={(e) =>
                                        setPolygonPayload({
                                          ...polygonPayload,
                                          dimensions: { type: "scalene", sideAMm: getDimValue("sideAMm"), sideBMm: getDimValue("sideBMm"), sideCMm: parseFloat(e.target.value) },
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}

                    {polygonPayload.polygonType === "rectangle" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label>Width (mm)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={PAPER_WIDTH_MM}
                            value={Number.isNaN(getDimValue("widthMm")) ? "" : getDimValue("widthMm")}
                            onChange={(e) =>
                              setPolygonPayload({
                                ...polygonPayload,
                                dimensions: { widthMm: parseFloat(e.target.value), heightMm: getDimValue("heightMm") },
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label>Height (mm)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={PAPER_HEIGHT_MM}
                            value={Number.isNaN(getDimValue("heightMm")) ? "" : getDimValue("heightMm")}
                            onChange={(e) =>
                              setPolygonPayload({
                                ...polygonPayload,
                                dimensions: { widthMm: getDimValue("widthMm"), heightMm: parseFloat(e.target.value) },
                              })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {!["triangle", "rectangle"].includes(polygonPayload.polygonType) && (
                      <div className="max-w-xs">
                        <Label>Side Length (mm)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={MAX_DIMENSION_MM}
                          value={Number.isNaN(getDimValue("sideLengthMm")) ? "" : getDimValue("sideLengthMm")}
                          onChange={(e) =>
                            setPolygonPayload({
                              ...polygonPayload,
                              dimensions: { sideLengthMm: parseFloat(e.target.value) },
                            })
                          }
                        />
                      </div>
                    )}

                    <p className="text-xs text-slate-400">
                      Max dimension: {MAX_DIMENSION_MM}mm (A4 paper constraint)
                    </p>
                  </div>
                )}

                {selectedType === "projectionAgent" && (
                  <p className="text-sm text-slate-500">
                    Projection agent is not yet configured. Submit to proceed with defaults.
                  </p>
                )}

                {error && (
                  <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <Button
                  variant="outline"
                  onClick={() => { setSelectedType(null); setError(null); }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !isIdle}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700"
                >
                  {submitting ? (
                    <>
                      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Processing...
                    </>
                  ) : (
                    "Submit Job"
                  )}
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Empty state hint */}
        {!selectedType && (
          <div className="mt-8 text-center">
            <p className="text-sm text-slate-400">
              Select a job type above to begin configuration
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
