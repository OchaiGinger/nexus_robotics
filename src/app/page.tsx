"use client";

import { useState } from "react";
import Link from "next/link";
import { useNexusMachine } from "@/app/context/machine-context";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AngleAgentPayload,
  GearAgentPayload,
  PolygonAgentPayload,
  JobType,
} from "@/lib/schemas/job-payloads";

const JOB_CARDS: {
  type: JobType;
  title: string;
  description: string;
}[] = [
  {
    type: "projectionAgent",
    title: "Projection",
    description: "No parameters yet — submit as-is.",
  },
  {
    type: "angleAgent",
    title: "Angle",
    description: "Construct an angle from a target degree value.",
  },
  {
    type: "gearAgent",
    title: "Gear",
    description:
      "Construct a gear from module, teeth count, and pressure angle.",
  },
  {
    type: "polygonAgent",
    title: "Polygon",
    description: "Construct a regular polygon from side count and length.",
  },
];

const emptyAngle: AngleAgentPayload = { label: "", angleDegrees: NaN };
const emptyGear: GearAgentPayload = {
  label: "",
  module: NaN,
  teethCount: NaN,
  pressureAngleDegrees: 20,
};
const emptyPolygon: PolygonAgentPayload = {
  label: "",
  sides: NaN,
  sideLengthMm: NaN,
};

export default function Home() {
  const { state, send } = useNexusMachine();
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
      case "projectionAgent":
        return {};
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
    } catch {
      setError("Could not reach the validation API");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Nexus jobs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Current state: <code>{JSON.stringify(state.value)}</code>
      </p>

      {!isIdle && (
        <p className="mt-3 text-sm text-muted-foreground">
          A job is already running — job creation re-enables once it finishes.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {JOB_CARDS.map(({ type, title, description }) => {
          const isSelected = selectedType === type;
          return (
            <Card
              key={type}
              onClick={() => handleSelect(type)}
              className={`cursor-pointer transition ${
                isSelected ? "ring-2 ring-primary" : ""
              } ${!isIdle ? "pointer-events-none opacity-50" : ""}`}
            >
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>

              {isSelected && (
                <CardContent onClick={(e) => e.stopPropagation()}>
                  {type === "angleAgent" && (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="angle-label">Label</Label>
                        <Input
                          id="angle-label"
                          value={anglePayload.label}
                          onChange={(e) =>
                            setAnglePayload({
                              ...anglePayload,
                              label: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="angle-degrees">Angle (degrees)</Label>
                        <Input
                          id="angle-degrees"
                          type="number"
                          value={
                            Number.isNaN(anglePayload.angleDegrees)
                              ? ""
                              : anglePayload.angleDegrees
                          }
                          onChange={(e) =>
                            setAnglePayload({
                              ...anglePayload,
                              angleDegrees: parseFloat(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {type === "gearAgent" && (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="gear-label">Label</Label>
                        <Input
                          id="gear-label"
                          value={gearPayload.label}
                          onChange={(e) =>
                            setGearPayload({
                              ...gearPayload,
                              label: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="gear-module">Module (mm)</Label>
                        <Input
                          id="gear-module"
                          type="number"
                          value={
                            Number.isNaN(gearPayload.module)
                              ? ""
                              : gearPayload.module
                          }
                          onChange={(e) =>
                            setGearPayload({
                              ...gearPayload,
                              module: parseFloat(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="gear-teeth">Teeth count</Label>
                        <Input
                          id="gear-teeth"
                          type="number"
                          value={
                            Number.isNaN(gearPayload.teethCount)
                              ? ""
                              : gearPayload.teethCount
                          }
                          onChange={(e) =>
                            setGearPayload({
                              ...gearPayload,
                              teethCount: parseInt(e.target.value, 10),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="gear-pressure">
                          Pressure angle (degrees)
                        </Label>
                        <Input
                          id="gear-pressure"
                          type="number"
                          value={gearPayload.pressureAngleDegrees}
                          onChange={(e) =>
                            setGearPayload({
                              ...gearPayload,
                              pressureAngleDegrees: parseFloat(e.target.value),
                            })
                          }
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Standard default is 20°.
                        </p>
                      </div>
                    </div>
                  )}

                  {type === "polygonAgent" && (
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="polygon-label">Label</Label>
                        <Input
                          id="polygon-label"
                          value={polygonPayload.label}
                          onChange={(e) =>
                            setPolygonPayload({
                              ...polygonPayload,
                              label: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="polygon-sides">Sides</Label>
                        <Input
                          id="polygon-sides"
                          type="number"
                          value={
                            Number.isNaN(polygonPayload.sides)
                              ? ""
                              : polygonPayload.sides
                          }
                          onChange={(e) =>
                            setPolygonPayload({
                              ...polygonPayload,
                              sides: parseInt(e.target.value, 10),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="polygon-length">Side length (mm)</Label>
                        <Input
                          id="polygon-length"
                          type="number"
                          value={
                            Number.isNaN(polygonPayload.sideLengthMm)
                              ? ""
                              : polygonPayload.sideLengthMm
                          }
                          onChange={(e) =>
                            setPolygonPayload({
                              ...polygonPayload,
                              sideLengthMm: parseFloat(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {type === "projectionAgent" && (
                    <p className="text-sm text-muted-foreground">
                      Nothing to fill in yet.
                    </p>
                  )}

                  {error && (
                    <p className="mt-3 text-sm text-destructive">{error}</p>
                  )}
                </CardContent>
              )}

              {isSelected && (
                <CardFooter onClick={(e) => e.stopPropagation()}>
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || !isIdle}
                    className="w-full"
                  >
                    {submitting ? "Validating…" : "Submit job"}
                  </Button>
                </CardFooter>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-sm">
        <Link href="/graph" className="underline">
          View state graph →
        </Link>
      </p>
    </div>
  );
}
