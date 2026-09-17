// src/app/api/actors/tool-append/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TaskRecord = { id: string; type: string; payload: unknown };

const TOOLS_BY_TYPE: Record<string, string[]> = {
  baseline: ["pencil", "ruler"],       // horizontal DrawInstruction
  arc: ["pencil", "compass"],          // real compass-drawn arc
  compass: ["pencil", "protractor"],   // measure DrawInstruction (renamed to "compass" by mapInstructionsToSteps)
  mark: ["pencil"],
  // add new task types here as they appear
};

function isVerticalRay(payload: unknown): boolean {
  const p = payload as { a?: [number, number]; b?: [number, number] } | null | undefined;
  const a = p?.a;
  const b = p?.b;
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0];
}

function getToolsForTask(task: TaskRecord): string[] {
  if (task.type === "ray") {
    return isVerticalRay(task.payload)
      ? ["pencil", "ruler", "45setsquare"]
      : ["pencil", "ruler"];
  }
  return TOOLS_BY_TYPE[task.type] ?? [];
}

export async function POST(req: NextRequest) {
  const toolResult = await req.json();

  if (!toolResult?.jobId || !Array.isArray(toolResult.tools)) {
    return NextResponse.json(
      { error: "toolResult must include jobId and a tools array of tasks" },
      { status: 400 },
    );
  }

  try {
    const requestedIds: string[] = toolResult.tools
      .map((t: { id?: string }) => t?.id)
      .filter((id: unknown): id is string => typeof id === "string");

    if (requestedIds.length === 0) {
      return NextResponse.json(
        { error: "toolResult.tools contained no valid task ids" },
        { status: 400 },
      );
    }

    const pendingTasks = await prisma.task.findMany({
      where: { id: { in: requestedIds }, jobId: toolResult.jobId, status: "pending" },
      select: { id: true, type: true, payload: true },
    });

    const pendingIds = new Set(pendingTasks.map((t) => t.id));
    const skipped = requestedIds.filter((id) => !pendingIds.has(id));

    await Promise.all(
      pendingTasks.map((task) =>
        prisma.task.update({
          where: { id: task.id },
          data: { tools: getToolsForTask(task) },
        }),
      ),
    );

    return NextResponse.json({
      label: "done",
      jobId: toolResult.jobId,
      updatedCount: pendingTasks.length,
      skipped,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}