// src/app/api/actors/sort-group/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ASSUMPTION: "threshold" = max cumulative step-difficulty per batch.
// 5 is a placeholder — tune once you know real batch sizing.
const DIFFICULTY_THRESHOLD = 5;

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();
  if (!jobId)
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  try {
    const ungroupedTasks = await prisma.task.findMany({
      where: { jobId, status: "waiting", sortGroupId: null },
      orderBy: { createdAt: "asc" },
    });

    if (ungroupedTasks.length === 0) {
      return NextResponse.json(
        { error: `No ungrouped waiting tasks found for job ${jobId}` },
        { status: 400 },
      );
    }

    const highestOrderGroup = await prisma.sortGroup.findFirst({
      orderBy: { order: "desc" },
    });
    let nextOrder = (highestOrderGroup?.order ?? 0) + 1;

    let firstCreatedGroupId: string | null = null;
    let currentGroupId: string | null = null;
    let currentGroupSum = 0;

    for (const task of ungroupedTasks) {
      const difficulty = (task.payload as any)?.difficulty ?? 1;

      if (
        !currentGroupId ||
        currentGroupSum + difficulty > DIFFICULTY_THRESHOLD
      ) {
        const group = await prisma.sortGroup.create({
          data: { status: "waiting", order: nextOrder++ },
        });
        currentGroupId = group.id;
        currentGroupSum = 0;
        if (!firstCreatedGroupId) firstCreatedGroupId = group.id;
      }

      await prisma.task.update({
        where: { id: task.id },
        data: { sortGroupId: currentGroupId },
      });
      currentGroupSum += difficulty;
    }

    return NextResponse.json({
      label: "done",
      sortGroupId: firstCreatedGroupId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
