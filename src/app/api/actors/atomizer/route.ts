// src/app/api/actors/atomizer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Actor = "robot" | "human";

type AtomDef = {
  actor: Actor;
  atomType: string;
  // Pulls real values out of the task's payload — undefined if this
  // atom needs no values (e.g. pickPencil). Reads `payload.labels`
  // (the exact per-point letter pair) rather than slicing the joined
  // `label` string, which breaks for multi-char letters like "Vup".
  values?: (payload: any) => unknown;
};

// A slot is 1 atom (done alone) or 2 atoms (done simultaneously by
// robot + human — a handoff/parallel moment).
type Slot = AtomDef[];

// CONFIRMED (baseline, arc, ray, compass, mark — from you).
const ATOM_SEQUENCE_BY_TASK_TYPE: Record<string, Slot[]> = {
  baseline: [
    [
      { actor: "robot", atomType: "pickPencil" },
      { actor: "human", atomType: "pickRuler" },
    ],
    [{ actor: "robot", atomType: "markPointX", values: (p) => ({ point: p?.a }) }],
    [{ actor: "human", atomType: "annotateLabel", values: (p) => ({ point: p?.a, label: p?.labels?.[0] }) }],
    [{ actor: "robot", atomType: "markPointY", values: (p) => ({ point: p?.b }) }],
    [{ actor: "human", atomType: "annotateLabel", values: (p) => ({ point: p?.b, label: p?.labels?.[1] }) }],
    [{ actor: "human", atomType: "placeRuler", values: (p) => ({ from: p?.a, to: p?.b }) }],
    [{ actor: "robot", atomType: "drawLine", values: (p) => ({ from: p?.a, to: p?.b }) }],
  ],

  arc: [
    [{ actor: "robot", atomType: "markCenter", values: (p) => ({ point: [p?.cx, p?.cy] }) }],
    [{ actor: "human", atomType: "annotateLabel", values: (p) => ({ point: [p?.cx, p?.cy], label: p?.labels?.[0] }) }],
    [{ actor: "human", atomType: "pickCompass" }],
    [{ actor: "human", atomType: "measure", values: (p) => ({ radius: p?.r }) }],
    [
      { actor: "human", atomType: "giveRobot" },
      { actor: "robot", atomType: "collect" },
    ],
    [
      {
        actor: "robot",
        atomType: "drawArc",
        values: (p) => ({ center: [p?.cx, p?.cy], radius: p?.r, angle: p?.deg }),
      },
    ],
  ],

  // compass: the relabeled "measure" step (see mapInstructionsToSteps —
  // Draws.drawMeasure produces a "measure" DrawInstruction, persisted
  // as Task.type "compass"). Human-only: reading a protractor gap,
  // nothing to mark or draw.
 compass: [
  [{ actor: "human", atomType: "pickProtractor" }],
  [{ actor: "human", atomType: "placeProtractor", values: (p) => ({ from: p?.a, to: p?.b }) }],
  [{ actor: "human", atomType: "measure", values: (p) => ({ from: p?.a, to: p?.b }) }],
  [{ actor: "robot", atomType: "markPoint", values: (p) => ({ point: p?.b }) }],
  [{ actor: "human", atomType: "annotateLabel", values: (p) => ({ point: p?.b, label: p?.labels?.[1] }) }],
  [
    { actor: "robot", atomType: "pickPencil" },
    { actor: "human", atomType: "pickRuler" },
  ],
  [{ actor: "human", atomType: "placeRuler", values: (p) => ({ from: p?.a, to: p?.b }) }],
  [{ actor: "robot", atomType: "drawLine", values: (p) => ({ from: p?.a, to: p?.b }) }],
],

  // mark: a standalone reference point (e.g. marking O)
  mark: [
  [{ actor: "robot", atomType: "markPoint", values: (p) => ({ point: p?.p }) }],
  [{ actor: "human", atomType: "annotateLabel", values: (p) => ({ point: p?.p, label: p?.l }) }],
], 
};

function isVerticalRay(payload: any): boolean {
  const a = payload?.a;
  const b = payload?.b;
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0];
}

// ray: horizontal and vertical share the same shape (mark A, label A,
// mark B, label B, place guide, draw) but differ on which guide tool
// the human uses — a vertical line needs a set square (balanced on the
// ruler) rather than the ruler alone.
function raySlots(payload: any): Slot[] {
  const vertical = isVerticalRay(payload);

  return [
    [
      { actor: "robot" as const, atomType: "pickPencil" },
      { actor: "human" as const, atomType: "pickRuler" },
    ],
    ...(vertical ? [[{ actor: "human" as const, atomType: "pickSetSquare" }]] : []),
    [{ actor: "robot", atomType: "markPointX", values: (p: any) => ({ point: p?.a }) }],
    [{ actor: "human", atomType: "annotateLabel", values: (p: any) => ({ point: p?.a, label: p?.labels?.[0] }) }],
    [{ actor: "robot", atomType: "markPointY", values: (p: any) => ({ point: p?.b }) }],
    [{ actor: "human", atomType: "annotateLabel", values: (p: any) => ({ point: p?.b, label: p?.labels?.[1] }) }],
    vertical
      ? [{ actor: "human" as const, atomType: "placeSetSquare", values: (p: any) => ({ from: p?.a, to: p?.b }) }]
      : [{ actor: "human" as const, atomType: "placeRuler", values: (p: any) => ({ from: p?.a, to: p?.b }) }],
    [{ actor: "robot", atomType: "drawLine", values: (p: any) => ({ from: p?.a, to: p?.b }) }],
  ];
}

function slotsFor(taskType: string, payload: unknown): Slot[] {
  if (taskType === "ray") return raySlots(payload);
  return ATOM_SEQUENCE_BY_TASK_TYPE[taskType] ?? [[{ actor: "robot", atomType: "execute" }]];
}

export async function POST(req: NextRequest) {
  const { job } = await req.json();
  const jobId = job?.id;
  if (!jobId)
    return NextResponse.json({ error: "job.id is required" }, { status: 400 });

  try {
    const tasks = await prisma.task.findMany({
      where: { jobId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    if (tasks.length === 0) {
      return NextResponse.json({ label: "done", jobId, route: "done", actions: [] });
    }

    // One row per slot (not per individual atom) — a 2-atom slot is a
    // single simultaneous pair, not two separate rows. Order preserved:
    // task by task, slot by slot within each task.
    const actions = tasks.flatMap((task) =>
      slotsFor(task.type, task.payload).map((slot, atomIndex) => ({
        taskId: task.id,
        atomIndex,
        atomType: slot.map((a) => a.atomType).join("+"), // e.g. "pickPencil+pickRuler"
        pair: slot.map((atom) => ({
          actor: atom.actor,
          atomType: atom.atomType,
          values: atom.values ? atom.values(task.payload) : null,
        })),
      })),
    );

    return NextResponse.json({ label: "done", jobId, route: "done", actions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}