"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
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
  ProjectionAgentPayload,
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

const emptyProjection: ProjectionAgentPayload = {
  label: "",
  imageDataUrl: undefined,
  imageMimeType: undefined,
  trellisModelUrl: undefined,
  trellisRenderUrl: undefined,
};

type JobSummary = {
  id: string;
  type: JobType;
  status: "queued" | "running" | "completed" | "failed";
  canResume: boolean;
  progress: number;
  taskCount: number;
  completedTaskCount: number;
  actionCount: number;
  completedActionCount: number;
  createdAt: string;
  lastActivity: string;
  payload: Record<string, unknown>;
};

type ProjectionArtifact = {
  kind: "local-preview" | "provider";
  vertices?: number[][];
  faces?: number[][];
  modelUrl?: string;
  renderUrl?: string;
  provider?: string;
};

type ProjectionApiResponse = {
  jobId?: string;
  artifact?: ProjectionArtifact;
  error?: string;
};

const PROJECTION_EXPORT_ANGLES = [0, 45, 90, 180, 270, 315];

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function drawProjectionScene(
  canvas: HTMLCanvasElement,
  artifact: ProjectionArtifact | null,
  image: HTMLImageElement | null,
  yawDegrees: number,
  pitchDegrees: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const scale = Math.min(width, height) / 5.8;
  const centerX = width / 2;
  const centerY = height / 2 + 20;

  const project = (point: number[]) => {
    const [x, y, z] = point;
    const rotatedX = x * Math.cos(yaw) - z * Math.sin(yaw);
    const rotatedZ = x * Math.sin(yaw) + z * Math.cos(yaw);
    const rotatedY = y * Math.cos(pitch) - rotatedZ * Math.sin(pitch);
    const depth = y * Math.sin(pitch) + rotatedZ * Math.cos(pitch);
    return {
      x: centerX + rotatedX * scale,
      y: centerY - rotatedY * scale,
      depth,
    };
  };

  if (image) {
    const corners = [
      [-1.05, -0.7, 0],
      [1.05, -0.7, 0],
      [1.05, 0.7, 0],
      [-1.05, 0.7, 0],
    ].map(project);
    const [a, b, , d] = corners;
    ctx.save();
    ctx.setTransform(
      b.x - a.x,
      b.y - a.y,
      d.x - a.x,
      d.y - a.y,
      a.x,
      a.y,
    );
    ctx.globalAlpha = 0.82;
    ctx.drawImage(image, 0, 0, 1, 1);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (!artifact?.vertices?.length || !artifact.faces?.length) {
    ctx.fillStyle = "#475569";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      artifact ? "Trellis model ready" : "Upload an image to build a 3D preview",
      centerX,
      42,
    );
    return;
  }

  const projectedFaces = artifact.faces.map((face) => ({
    face,
    points: face.map((index) => project(artifact.vertices![index])),
  }));
  projectedFaces.sort(
    (a, b) =>
      b.points.reduce((sum, point) => sum + point.depth, 0) -
      a.points.reduce((sum, point) => sum + point.depth, 0),
  );

  for (const { points } of projectedFaces) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(139, 92, 246, 0.16)";
    ctx.fill();
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function renderProjectionFrame(
  artifact: ProjectionArtifact,
  image: HTMLImageElement | null,
  yawDegrees: number,
  pitchDegrees: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 620;
  drawProjectionScene(canvas, artifact, image, yawDegrees, pitchDegrees);
  return canvas.toDataURL("image/png");
}

function formatJobDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function jobTitle(job: JobSummary) {
  const label = job.payload.label;
  return typeof label === "string" && label.trim()
    ? label
    : job.type.replace("Agent", "");
}

export default function Home() {
  const { state, send } = useNexusMachine();
  const router = useNextRouter();
  const isIdle = state.matches("idle");

  const [selectedType, setSelectedType] = useState<JobType | null>(null);
  const [anglePayload, setAnglePayload] = useState(emptyAngle);
  const [gearPayload, setGearPayload] = useState(emptyGear);
  const [polygonPayload, setPolygonPayload] = useState(emptyPolygon);
  const [projectionPayload, setProjectionPayload] = useState(emptyProjection);
  const [projectionImage, setProjectionImage] = useState<HTMLImageElement | null>(null);
  const [projectionArtifact, setProjectionArtifact] = useState<ProjectionArtifact | null>(null);
  const [projectionStatus, setProjectionStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [projectionYaw, setProjectionYaw] = useState(35);
  const [projectionPitch, setProjectionPitch] = useState(24);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);

    try {
      const response = await fetch("/api/jobs");
      const data = (await response.json()) as { jobs?: JobSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not load jobs");
      }
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Could not load jobs");
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const resetForms = () => {
    setAnglePayload(emptyAngle);
    setGearPayload(emptyGear);
    setPolygonPayload(emptyPolygon);
    setProjectionPayload(emptyProjection);
    setProjectionImage(null);
    setProjectionArtifact(null);
    setProjectionStatus("idle");
    setProjectionYaw(35);
    setProjectionPitch(24);
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
        return projectionPayload;
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
    if (selectedType === "projectionAgent" && !projectionPayload.imageDataUrl) {
      setError("Upload a source image before submitting a projection job");
      return;
    }

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
      await loadJobs();
      router.push("/graph");
    } catch {
      setError("Could not reach the validation API");
    } finally {
      setSubmitting(false);
    }
  };

  const resumeJob = async (jobId: string) => {
    if (!isIdle) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = (await response.json()) as {
        job?: { id: string; type: JobType; payload: unknown };
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error ?? "Could not restore job");
      }

      send({ type: "new_job", job: data.job });
      await loadJobs();
      router.push("/graph");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore job");
    } finally {
      setSubmitting(false);
    }
  };

  const handleProjectionFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Projection source must be an image");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Projection image must be smaller than 5 MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const imageDataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!imageDataUrl) return;

      const image = new Image();
      image.onload = () => {
        setProjectionImage(image);
        setProjectionPayload((current) => ({
          ...current,
          imageDataUrl,
          imageMimeType: file.type,
        }));
        setProjectionArtifact(null);
        setProjectionStatus("idle");
        setError(null);
      };
      image.src = imageDataUrl;
    };
    reader.onerror = () => setError("Could not read the projection image");
    reader.readAsDataURL(file);
  };

  const handleProjectionReconstruct = async () => {
    if (!projectionPayload.imageDataUrl) {
      setError("Upload a source image before reconstruction");
      return;
    }

    setProjectionStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/projection/reconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: `preview-${Date.now()}`,
          payload: projectionPayload,
        }),
      });
      const data = (await response.json()) as ProjectionApiResponse & { steps?: unknown[] };
      if (!response.ok || !data.artifact) {
        throw new Error(data.error ?? "Trellis reconstruction failed");
      }

      setProjectionArtifact(data.artifact);
      setProjectionPayload((current) => ({
        ...current,
        trellisModelUrl: data.artifact.modelUrl,
        trellisRenderUrl: data.artifact.renderUrl,
      }));
      setProjectionStatus("ready");
    } catch (err) {
      setProjectionStatus("error");
      setError(err instanceof Error ? err.message : "Trellis reconstruction failed");
    }
  };

  const handleProjectionSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas || !projectionArtifact) return;
    downloadDataUrl(canvas.toDataURL("image/png"), "projection-snapshot.png");
  };

  const handleProjectionExports = () => {
    if (!projectionArtifact || !projectionImage) return;
    for (const angle of PROJECTION_EXPORT_ANGLES) {
      downloadDataUrl(
        renderProjectionFrame(projectionArtifact, projectionImage, angle, projectionPitch),
        `projection-${angle}deg.png`,
      );
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawProjectionScene(
      canvas,
      projectionArtifact,
      projectionImage,
      projectionYaw,
      projectionPitch,
    );
  }, [projectionArtifact, projectionImage, projectionPitch, projectionYaw]);

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
        <section className="mb-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                Recent Jobs
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Persisted work can be resumed from the last stored task state.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadJobs} disabled={jobsLoading}>
              {jobsLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {jobsError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {jobsError}
            </div>
          )}

          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-6 text-center text-sm text-slate-400">
              No persisted jobs yet.
            </div>
          )}

          {jobs.length > 0 && (
            <div className="mt-4 space-y-3">
              {jobs.map((job) => {
                const statusClass = {
                  queued: "bg-slate-100 text-slate-600",
                  running: "bg-amber-50 text-amber-700",
                  completed: "bg-emerald-50 text-emerald-700",
                  failed: "bg-red-50 text-red-700",
                }[job.status];
                const progressPercent = Math.round(job.progress * 100);

                return (
                  <div key={job.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold text-slate-900">{jobTitle(job)}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusClass}`}>
                            {job.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {job.type} · {job.completedTaskCount}/{job.taskCount} tasks ·{" "}
                          {job.completedActionCount}/{job.actionCount} actions
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Updated {formatJobDate(job.lastActivity)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!job.canResume || !isIdle || submitting}
                        onClick={() => void resumeJob(job.id)}
                      >
                        {job.canResume ? "Resume" : "Closed"}
                      </Button>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${job.status === "completed" ? "bg-emerald-500" : job.status === "failed" ? "bg-red-500" : "bg-indigo-500"}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="mt-1 text-right text-[11px] text-slate-400">{progressPercent}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

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
                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                      <div>
                        <Label htmlFor="projection-label">Projection label</Label>
                        <Input
                          id="projection-label"
                          placeholder="e.g. Bracket reference"
                          value={projectionPayload.label}
                          onChange={(event) =>
                            setProjectionPayload({ ...projectionPayload, label: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Source image</Label>
                        <Input
                          id="projection-image"
                          type="file"
                          accept="image/*"
                          onChange={handleProjectionFile}
                          disabled={submitting}
                          className="cursor-pointer"
                        />
                      </div>
                    </div>

                    {projectionPayload.imageDataUrl && (
                      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-slate-800">Uploaded source</div>
                              <div className="text-xs text-slate-500">
                                {projectionPayload.imageMimeType ?? "image"}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleProjectionReconstruct}
                              disabled={submitting || projectionStatus === "loading"}
                            >
                              {projectionStatus === "loading" ? "Reconstructing..." : "Reconstruct 3D"}
                            </Button>
                          </div>
                          <img
                            src={projectionPayload.imageDataUrl}
                            alt="Uploaded projection source"
                            className="mt-3 max-h-56 w-full rounded-md object-contain bg-white"
                          />
                          {projectionArtifact && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                              <span className={`rounded-full px-2 py-1 ${projectionArtifact.kind === "provider" ? "bg-purple-50 text-purple-700" : "bg-slate-200 text-slate-600"}`}>
                                {projectionArtifact.kind === "provider" ? "Trellis provider" : "Local preview"}
                              </span>
                              {projectionArtifact.provider && (
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                                  {projectionArtifact.provider}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-slate-800">3D projection workbench</div>
                              <div className="text-xs text-slate-500">
                                {projectionArtifact ? "Adjust the view, capture a snapshot, or export angles." : "Reconstruct the uploaded image to enable the workbench."}
                              </div>
                            </div>
                          </div>
                          <canvas
                            ref={canvasRef}
                            width={900}
                            height={620}
                            className="mt-3 h-auto w-full rounded-md border border-slate-200 bg-white"
                          />
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label htmlFor="projection-yaw">Yaw ({projectionYaw}°)</Label>
                              <Input
                                id="projection-yaw"
                                type="range"
                                min={0}
                                max={360}
                                value={projectionYaw}
                                onChange={(event) => setProjectionYaw(Number(event.target.value))}
                              />
                            </div>
                            <div>
                              <Label htmlFor="projection-pitch">Pitch ({projectionPitch}°)</Label>
                              <Input
                                id="projection-pitch"
                                type="range"
                                min={0}
                                max={90}
                                value={projectionPitch}
                                onChange={(event) => setProjectionPitch(Number(event.target.value))}
                              />
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleProjectionSnapshot}
                              disabled={!projectionArtifact}
                            >
                              Snapshot PNG
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleProjectionExports}
                              disabled={!projectionArtifact || !projectionImage}
                            >
                              Export 6 angles
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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
