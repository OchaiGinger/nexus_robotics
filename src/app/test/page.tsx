"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { runAngleJob } from "@/machine/actors/angleActor";
import type { AngleJob } from "@/machine/actors/angleActor";

type DecompItem = number | `c${number}`;
type Step =
  | { t: "baseline"; len: number; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" }
  | { t: "mark"; p: [number, number]; l: string; dir: "cw" | "ccw" }
  | { t: "ray"; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" }
  | { t: "arc"; r: number; deg: number; cx: number; cy: number; dir: "cw" | "ccw"; l: string; a: [number, number]; b: [number, number] }
  | { t: "bisect"; l1: string; l2: string; deg: number; type: "angle" | "line"; l: string; m: [number, number]; substeps: Step[]; dir: "cw" | "ccw" }
  | { t: "compass"; deg: number; l: string; a: [number, number]; b: [number, number]; dir: "cw" | "ccw" };

type AngleResult = {
  angle: number;
  quadrant: 1 | 2 | 3 | 4;
  gap: number;
  from: string;
  decomp: { full: DecompItem[]; gap: DecompItem[] };
  steps: Step[];
};

type ActorOutput = {
  label: "done";
  jobId: string;
  agent: string;
  result: AngleResult;
};

const SCALE = 2.5;
const ACTOR_ORIGIN_X = 150;
const ACTOR_ORIGIN_Y = 110;
const CANVAS_CENTER_X = 360;
const CANVAS_CENTER_Y = 250;

function toScreen(x: number, y: number, dir: "cw" | "ccw" = "cw"): [number, number] {
  const flipY = dir === "ccw" ? -1 : 1;
  return [
    CANVAS_CENTER_X + (x - ACTOR_ORIGIN_X) * SCALE,
    CANVAS_CENTER_Y - flipY * (y - ACTOR_ORIGIN_Y) * SCALE,
  ];
}

function formatDecompItem(item: DecompItem): string {
  return typeof item === "string" ? `compass ${item.slice(1)}°` : `${item}°`;
}

function formatDecomp(arr: DecompItem[]): string {
  return arr.map(formatDecompItem).join(" + ");
}

function DraftingCanvas({ steps, currentStep, showAll }: { steps: Step[]; currentStep: number; showAll: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fffef7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#e8e4dc";
    ctx.lineWidth = 0.3;
    for (let x = 0; x < canvas.width; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#c8c0b4";
    ctx.lineWidth = 0.6;
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const [ox, oy] = toScreen(ACTOR_ORIGIN_X, ACTOR_ORIGIN_Y);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(canvas.width, oy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, canvas.height);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    for (let x = 0; x < canvas.width; x += 50) {
      const wx = Math.round((x - CANVAS_CENTER_X) / SCALE + ACTOR_ORIGIN_X);
      if (wx !== ACTOR_ORIGIN_X) ctx.fillText(`${wx}`, x, oy + 12);
    }
    ctx.textAlign = "right";
    for (let y = 0; y < canvas.height; y += 50) {
      const wy = Math.round(ACTOR_ORIGIN_Y + (y - CANVAS_CENTER_Y) / SCALE);
      if (wy !== ACTOR_ORIGIN_Y) ctx.fillText(`${wy}`, ox - 6, y + 3);
    }

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("O", ox + 8, oy + 4);

    const pointRegistry = new Map<string, [number, number]>();
    pointRegistry.set("O", [ACTOR_ORIGIN_X, ACTOR_ORIGIN_Y]);
    pointRegistry.set("start", [ACTOR_ORIGIN_X, ACTOR_ORIGIN_Y]);

    const visibleSteps = showAll ? steps : steps.slice(0, currentStep + 1);

    visibleSteps.forEach((step) => {
      if (step.t === "baseline") {
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (step.l === "AB") {
          pointRegistry.set("A", [step.a[0], step.a[1]]);
          pointRegistry.set("B", [step.b[0], step.b[1]]);
        }
      } else if (step.t === "ray") {
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (step.l === "VU") pointRegistry.set("VUP", [step.b[0], step.b[1]]);
        else if (step.l === "VD") pointRegistry.set("VDOWN", [step.b[0], step.b[1]]);
      } else if (step.t === "arc") {
        if (!step.a || !step.b) return;
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const r = step.r * SCALE;
        const [cx, cy] = toScreen(step.cx, step.cy, step.dir);
        const sa = Math.atan2(y1 - cy, x1 - cx);
        const ea = Math.atan2(y2 - cy, x2 - cx);
        let arcDiff = ea - sa;
        while (arcDiff > Math.PI) arcDiff -= 2 * Math.PI;
        while (arcDiff < -Math.PI) arcDiff += 2 * Math.PI;
        ctx.arc(cx, cy, r, sa, ea, arcDiff >= 0);
        ctx.stroke();
      } else if (step.t === "bisect") {
        const [mx, my] = toScreen(step.m[0], step.m[1], step.dir);
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#92400e";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${step.type} ${step.deg}°`, mx + 6, my - 4);
        const idx = step.l.replace("bisect_", "");
        pointRegistry.set(`M${idx}`, [step.m[0], step.m[1]]);

        step.substeps.forEach((sub) => {
          if (sub.t === "arc") {
            if (!sub.a || !sub.b) return;
            const [sx1, sy1] = toScreen(sub.a[0], sub.a[1], step.dir);
            const [sx2, sy2] = toScreen(sub.b[0], sub.b[1], step.dir);
            const [scx, scy] = toScreen(sub.cx, sub.cy, step.dir);
            ctx.strokeStyle = step.type === "angle" ? "#3b82f6" : "#8b5cf6";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const sr = sub.r * SCALE;
             const ssa = Math.atan2(sy1 - scy, sx1 - scx);
             const sea = Math.atan2(sy2 - scy, sx2 - scx);
             let diff = sea - ssa;
             while (diff > Math.PI) diff -= 2 * Math.PI;
             while (diff < -Math.PI) diff += 2 * Math.PI;
             ctx.arc(scx, scy, sr, ssa, sea, diff >= 0);
            ctx.stroke();
          } else if (sub.t === "mark") {
            const [spx, spy] = toScreen(sub.p[0], sub.p[1], sub.dir);
            ctx.fillStyle = step.type === "angle" ? "#3b82f6" : "#8b5cf6";
            ctx.beginPath();
            ctx.arc(spx, spy, 3, 0, Math.PI * 2);
            ctx.fill();
          } else if (sub.t === "ray") {
            const [sx1, sy1] = toScreen(sub.a[0], sub.a[1], sub.dir);
            const [sx2, sy2] = toScreen(sub.b[0], sub.b[1], sub.dir);
            ctx.strokeStyle = step.type === "angle" ? "#3b82f6" : "#8b5cf6";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });
      } else if (step.t === "compass") {
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (step.t === "mark") {
        const [px, py] = toScreen(step.p[0], step.p[1], step.dir);
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        pointRegistry.set(step.l, [step.p[0], step.p[1]]);
        if (step.l !== "O" && step.l !== "A" && step.l !== "B" && step.l !== "VUP" && step.l !== "VDOWN") {
          ctx.fillStyle = "#64748b";
          ctx.font = "8px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(step.l, px + 5, py - 3);
        }
      }
    });

    if (!showAll && currentStep >= 0 && currentStep < steps.length) {
      const step = steps[currentStep];
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 3;
      if (step.t === "baseline" || step.t === "ray" || step.t === "compass") {
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (step.t === "mark") {
        const [px, py] = toScreen(step.p[0], step.p[1], step.dir);
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (step.t === "bisect") {
        const [mx, my] = toScreen(step.m[0], step.m[1], step.dir);
        ctx.beginPath();
        ctx.arc(mx, my, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (step.t === "arc") {
        if (!step.a || !step.b) return;
        const [x1, y1] = toScreen(step.a[0], step.a[1], step.dir);
        const [x2, y2] = toScreen(step.b[0], step.b[1], step.dir);
        const r = step.r * SCALE;
        const [cx, cy] = toScreen(step.cx, step.cy, step.dir);
        const sa = Math.atan2(y1 - cy, x1 - cx);
        const ea = Math.atan2(y2 - cy, x2 - cx);
        let arcDiff = ea - sa;
        while (arcDiff > Math.PI) arcDiff -= 2 * Math.PI;
        while (arcDiff < -Math.PI) arcDiff += 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, r, sa, ea, arcDiff >= 0);
        ctx.stroke();
      }
    }
  }, [steps, currentStep, showAll]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={720}
      height={500}
      className="rounded-lg border-2 border-slate-300 shadow-sm"
    />
  );
}

function StepInfo({ step, index }: { step: Step; index: number }) {
  const getDescription = (): string => {
    switch (step.t) {
      case "baseline":
        return `Draw baseline ${step.l} from (${step.a}) to (${step.b})`;
      case "mark":
        return `Mark point ${step.l} at (${step.p})`;
      case "ray":
        return `Draw ray ${step.l} from (${step.a}) to (${step.b})`;
      case "arc":
        return `Arc ${step.l}: ${step.deg}° ${step.dir} centered at (${step.cx},${step.cy}) from (${step.a}) to (${step.b})`;
      case "bisect":
        return `Bisect ${step.type}: ${step.deg}° → ${step.substeps.length} construction steps`;
      case "compass":
        return `Compass measure ${step.deg}° from (${step.a}) to (${step.b})`;
      default:
        return "";
    }
  };

  return (
    <div className="flex items-start gap-2 rounded bg-slate-50 px-2 py-1.5 text-[10px]">
      <span className="font-mono font-bold text-indigo-600">{index + 1}</span>
      <span className="rounded bg-slate-200 px-1 font-medium text-slate-600">{step.t}</span>
      <span className="flex-1 text-slate-700">{getDescription()}</span>
    </div>
  );
}

export default function TestPage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ActorOutput | null>(null);
  const [rawJson, setRawJson] = useState<string>("");
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBisect, setExpandedBisect] = useState<Set<number>>(new Set());
  const [inputAngle, setInputAngle] = useState<string>("");
  const playInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const dataParam = searchParams.get("data");
    if (dataParam) {
      try {
        const parsed = JSON.parse(decodeURIComponent(dataParam));
        if (parsed.result && parsed.result.steps) {
          setData(parsed);
          setRawJson(JSON.stringify(parsed, null, 2));
          setError(null);
        }
      } catch {
        setError("Failed to parse data from URL");
      }
    }
  }, [searchParams]);

  const handleJsonSubmit = () => {
    try {
      const parsed = JSON.parse(rawJson);
      if (!parsed.result || !parsed.result.steps) {
        setError("JSON must include result.steps");
        return;
      }
      setData(parsed);
      setError(null);
      setCurrentStep(-1);
      setShowAll(false);
    } catch {
      setError("Invalid JSON");
    }
  };

  const handleAngleSubmit = () => {
    const angle = parseFloat(inputAngle);
    if (isNaN(angle) || angle <= 0 || angle >= 360) {
      setError("Enter an angle between 0 and 360");
      return;
    }
    try {
      const result = runAngleJob({
        id: "test-" + Date.now(),
        payload: { label: "test angle", angleDegrees: angle },
      });
      setData(result);
      setRawJson(JSON.stringify(result, null, 2));
      setError(null);
      setCurrentStep(-1);
      setShowAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Construction failed");
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      if (playInterval.current) clearInterval(playInterval.current);
      setIsPlaying(false);
    } else {
      if (currentStep < 0) setCurrentStep(0);
      setIsPlaying(true);
      playInterval.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (!data || prev >= flatTotal - 1) {
            if (playInterval.current) clearInterval(playInterval.current);
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 800);
    }
  };

  useEffect(() => {
    return () => {
      if (playInterval.current) clearInterval(playInterval.current);
    };
  }, []);

  if (!data || !data.result) {
    return (
      <div className="flex h-screen flex-col bg-slate-100">
        <header className="flex h-10 items-center border-b border-slate-200 bg-white px-3">
          <span className="text-xs font-bold text-slate-800">Drafting Tester</span>
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">RLHF</span>
        </header>
         <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Enter Angle</h2>
            <div className="mb-6 flex gap-2">
              <input
                type="number"
                value={inputAngle}
                onChange={(e) => setInputAngle(e.target.value)}
                placeholder="e.g. 90"
                className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleAngleSubmit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Run Angle Actor
              </button>
            </div>
            {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Or Paste Actor Output JSON</h2>
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              placeholder='{"label":"done","jobId":"...","agent":"angleActor","result":{...}}'
              className="h-64 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800"
            />
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <button
              onClick={handleJsonSubmit}
              className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Load & Render
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { result } = data;
  const totalSteps = result.steps.length;

  const flatSteps: Step[] = [];
  result.steps.forEach((step) => {
    if (step.t === "bisect") {
      step.substeps.forEach((sub) => flatSteps.push(sub));
    } else {
      flatSteps.push(step);
    }
  });
  const flatTotal = flatSteps.length;

  const toggleBisect = (index: number) => {
    setExpandedBisect((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const renderStep = (step: Step, index: number, indent: number = 0) => {
    const isBisect = step.t === "bisect";
    const isExpanded = isBisect && expandedBisect.has(index);
    const isCurrent = index === currentStep;

    return (
      <div key={`${index}-${indent}`}>
        <div
          onClick={() => {
            setCurrentStep(index);
            setShowAll(false);
            if (isBisect) toggleBisect(index);
          }}
          className={`cursor-pointer rounded px-1.5 py-1 text-[9px] transition-colors ${
            isCurrent ? "bg-indigo-100 text-indigo-700" : index <= currentStep ? "bg-slate-50 text-slate-600" : "text-slate-400 hover:bg-slate-50"
          }`}
          style={{ paddingLeft: `${indent * 8 + 6}px` }}
        >
          <span className="font-mono font-bold">{index + 1}.</span> {step.t} {step.l}
          {isBisect && <span className="ml-1 text-[8px] text-slate-400">({step.substeps.length})</span>}
          {isBisect && <span className="ml-1 text-[8px]">{isExpanded ? "▼" : "▶"}</span>}
        </div>
        {isExpanded && step.t === "bisect" && step.substeps.map((sub, si) => (
          <div
            key={`sub-${si}`}
            className="rounded px-1.5 py-0.5 text-[8px] text-slate-500"
            style={{ paddingLeft: `${(indent + 1) * 8 + 6}px` }}
          >
            <span className="font-mono">{si + 1}.</span> {sub.t} {sub.l}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex h-10 items-center justify-between border-b border-slate-200 bg-white px-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setData(null);
              setInputAngle("");
              setRawJson("");
              setCurrentStep(-1);
              setShowAll(false);
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="New Test"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-bold text-slate-800">Drafting Tester</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">RLHF</span>
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">{result.angle}°</span>
          <span className="text-[10px] text-slate-400">Q{result.quadrant}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span>Gap: {result.gap}° from {result.from}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-56 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-2">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Decomposition</h3>
            <div className="space-y-1.5">
              <div>
                <p className="text-[9px] font-medium text-slate-400">Full</p>
                <p className="text-[10px] text-slate-700">{formatDecomp(result.decomp.full)}</p>
              </div>
              <div>
                <p className="text-[9px] font-medium text-slate-400">Gap</p>
                <p className="text-[10px] text-slate-700">{formatDecomp(result.decomp.gap)}</p>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Steps ({currentStep + 1}/{flatTotal})
            </h3>
            <div className="space-y-1">
              {flatSteps.map((step, i) => (
                <div
                  key={i}
                  onClick={() => { setCurrentStep(i); setShowAll(false); }}
                  className={`cursor-pointer rounded px-1.5 py-1 text-[9px] transition-colors ${
                    i === currentStep ? "bg-indigo-100 text-indigo-700" : i <= currentStep ? "bg-slate-50 text-slate-600" : "text-slate-400 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-mono font-bold">{i + 1}.</span> {step.t} {step.l}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setCurrentStep(-1); setShowAll(false); }}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                title="Reset"
              >
                <SkipBack size={14} />
              </button>
              <button
                onClick={() => setCurrentStep((p) => Math.max(0, p - 1))}
                disabled={currentStep <= 0}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                title="Previous"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={togglePlay}
                className="rounded bg-indigo-600 p-1.5 text-white hover:bg-indigo-700"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => setCurrentStep((p) => Math.min(flatTotal - 1, p + 1))}
                disabled={currentStep >= flatTotal - 1}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                title="Next"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => setCurrentStep(flatTotal - 1)}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                title="Skip to end"
              >
                <SkipForward size={14} />
              </button>
              <button
                onClick={() => setShowAll((p) => !p)}
                className={`rounded px-2 py-1 text-[10px] font-medium ${showAll ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
              >
                {showAll ? "Showing All" : "Show All"}
              </button>
            </div>
            <div className="text-[10px] text-slate-400">
              {currentStep >= 0 ? `Step ${currentStep + 1} of ${flatTotal}` : "Click a step or press Play"}
            </div>
          </div>

          <div className="flex justify-center">
            <DraftingCanvas steps={flatSteps} currentStep={currentStep} showAll={showAll} />
          </div>

          {currentStep >= 0 && currentStep < flatTotal && (
            <div className="mt-3 flex justify-center">
              <div className="w-full max-w-2xl">
                <StepInfo step={flatSteps[currentStep]} index={currentStep} />
              </div>
            </div>
          )}
        </div>

        <div className="flex w-56 flex-col border-l border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-2">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Raw JSON</h3>
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="h-48 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[8px] text-slate-600"
            />
            <button
              onClick={handleJsonSubmit}
              className="mt-1.5 w-full rounded bg-slate-200 px-2 py-1 text-[9px] font-medium text-slate-600 hover:bg-slate-300"
            >
              Reload
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Legend</h3>
            <div className="space-y-1 text-[9px]">
              <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-slate-800"></span> Baseline</div>
              <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-slate-500" style={{ borderTop: "1px dashed" }}></span> Ray</div>
              <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-blue-600"></span> Arc</div>
              <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-red-500" style={{ borderTop: "1px dashed" }}></span> Compass</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span> Bisect point</div>
              <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-red-500"></span> Mark point</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
