// src/app/api/actors/atomizer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Actor = "robot" | "human";

type AtomDef = {
  actor: Actor;
  atomType: string;
  // Pulls real values out of the task's payload — undefined if this
  // atom needs no values (e.g. pickPencil).
  values?: (payload: any) => unknown;
};

// A slot is 1 atom (done alone) or 2 atoms (done simultaneously by
// robot + human — a handoff/parallel moment).
type Slot = AtomDef[];

// CONFIRMED (baseline, arc — from you). Everything else is a single
// placeholder atom until you give me the real breakdown.
const ATOM_SEQUENCE_BY_TASK_TYPE: Record<string, Slot[]> = {
  baseline: [
    [
      { actor: "robot", atomType: "pickPencil" },
      { actor: "human", atomType: "pickRuler" },
    ],
    [
      {
        actor: "robot",
        atomType: "markPointX",
        values: (p) => ({ point: p?.a }),
      },
    ],
    [
      {
        actor: "robot",
        atomType: "markPointY",
        values: (p) => ({ point: p?.b }),
      },
    ],
    [
      {
        actor: "human",
        atomType: "placeRuler",
        values: (p) => ({ from: p?.a, to: p?.b }),
      },
    ],
    [
      {
        actor: "robot",
        atomType: "drawLine",
        values: (p) => ({ from: p?.a, to: p?.b }),
      },
    ],
  ],

  arc: [
    [{ actor: "human", atomType: "pickCompass" }],
    [
      {
        actor: "human",
        atomType: "measure",
        values: (p) => ({ radius: p?.r }),
      },
    ],
    [
      { actor: "human", atomType: "giveRobot" },
      { actor: "robot", atomType: "collect" },
    ],
    [
      {
        actor: "robot",
        atomType: "drawArc",
        values: (p) => ({
          center: [p?.cx, p?.cy],
          radius: p?.r,
          angle: p?.deg,
        }),
      },
    ],
  ],

  // ASSUMED placeholders — replace when you give me the real breakdowns:
  ray: [[{ actor: "robot", atomType: "execute" }]],
  compass: [[{ actor: "human", atomType: "execute" }]],
  mark: [[{ actor: "robot", atomType: "execute" }]],
};

function slotsFor(taskType: string): Slot[] {
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
      slotsFor(task.type).map((slot, atomIndex) => ({
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