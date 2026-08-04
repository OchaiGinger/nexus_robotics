// src/app/api/actors/atomizer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// CONFIRMED (verticalLine, from you). Everything else is a single
// placeholder atom until you give me the real breakdowns — flagged
// loudly so it's obvious what's real vs stand-in.
const ATOM_SEQUENCE_BY_TASK_TYPE: Record<string, string[]> = {
  verticalLine: [
    "pickPencil",
    "pickRuler",
    "calibrate",
    "markPointX",
    "markPointY",
  ],
  // ASSUMED placeholders — replace when you're ready:
  baseline: ["execute"],
  horizontalLine: ["execute"],
  angleLine: ["execute"],
  bisector: ["execute"],
  circle: ["execute"],
};

function atomsFor(taskType: string): string[] {
  return ATOM_SEQUENCE_BY_TASK_TYPE[taskType] ?? ["execute"];
}

// ASSUMED shape for robot/human instructions — nothing downstream
// (robotActor, humanActor) has told us the real contract yet.
function buildPair(
  taskId: string,
  taskType: string,
  atomIndex: number,
  atomType: string,
) {
  return {
    taskId,
    taskType,
    atomIndex,
    atomType,
    robotInstruction: { atomType }, // ASSUMED
    humanInstruction: { atomType }, // ASSUMED
  };
}

export async function POST(req: NextRequest) {
  const { job, actionsResult } = await req.json();
  const jobId = job?.id;
  if (!jobId)
    return NextResponse.json({ error: "job.id is required" }, { status: 400 });

  try {
    const prevPair = actionsResult?.pair as
      | { taskId: string; taskType: string; atomIndex: number }
      | undefined;

    // Loop call: previous atom was just validated (updateActionsTable
    // only hands back here via the validator-valid path).
    if (prevPair) {
      const atoms = atomsFor(prevPair.taskType);
      const nextIndex = prevPair.atomIndex + 1;

      if (nextIndex < atoms.length) {
        const pair = buildPair(
          prevPair.taskId,
          prevPair.taskType,
          nextIndex,
          atoms[nextIndex],
        );
        return NextResponse.json({
          label: "done",
          jobId,
          route: "actions",
          pair,
        });
      }

      // that was the task's last atom — close it out
      await prisma.task.update({
        where: { id: prevPair.taskId },
        data: { status: "actioned" },
      });

      const remaining = await prisma.task.findFirst({
        where: { jobId, status: "pending" },
      });

      return NextResponse.json({
        label: "done",
        jobId,
        route: "taskDone",
        hasMoreTasks: !!remaining,
      });
    }

    // First call for this batch's work — pick the earliest untouched task
    const task = await prisma.task.findFirst({
      where: { jobId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    if (!task) {
      return NextResponse.json({
        label: "done",
        jobId,
        route: "taskDone",
        hasMoreTasks: false,
      });
    }

    const atoms = atomsFor(task.type);
    const pair = buildPair(task.id, task.type, 0, atoms[0]);
    return NextResponse.json({ label: "done", jobId, route: "actions", pair });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
