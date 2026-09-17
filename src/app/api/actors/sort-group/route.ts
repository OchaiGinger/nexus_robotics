// src/app/api/actors/sort-group/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DIFFICULTY_THRESHOLD = 10;

const DIFFICULTY_BY_TYPE: Record<string, number> = {
  mark: 2,
  ray: 4,
  baseline: 4,
  arc: 6,
  compass: 2,
};

function getDifficulty(task: { type: string; payload: unknown }): number {
  if (task.type === "ray") {
    const label = (task.payload as { l?: string } | null)?.l ?? "";
    if (label.includes("Vup") || label.includes("Vdown")) return 6;
  }
  return DIFFICULTY_BY_TYPE[task.type] ?? 1;
}

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

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

    const withDifficulty = ungroupedTasks.map((task) => ({
      task,
      difficulty: getDifficulty(task),
    }));

    type GroupBucket = {
      difficulty: number;
      taskIds: string[];
      taskTypes: string[];
      taskDifficulties: number[];
    };
    const buckets: GroupBucket[] = [];
    let current: GroupBucket | null = null;

    for (const { task, difficulty } of withDifficulty) {
      if (!current || current.difficulty + difficulty > DIFFICULTY_THRESHOLD) {
        current = { difficulty: 0, taskIds: [], taskTypes: [], taskDifficulties: [] };
        buckets.push(current);
      }
      current.taskIds.push(task.id);
      current.taskTypes.push(task.type);
      current.taskDifficulties.push(difficulty);
      current.difficulty += difficulty;
    }

    const groups = await prisma.$transaction(
      async (tx) => {
        const highestOrderGroup = await tx.sortGroup.findFirst({
          where: { jobId },
          orderBy: { order: "desc" },
        });
        let nextOrder = (highestOrderGroup?.order ?? 0) + 1;

        const created: Array<{
          id: string;
          order: number;
          difficulty: number;
          taskIds: string[];
          taskTypes: string[];
        }> = [];

        for (const bucket of buckets) {
          const group = await tx.sortGroup.create({
            data: {
              jobId,
              status: "waiting",
              order: nextOrder++,
            },
          });

          await tx.task.updateMany({
            where: { id: { in: bucket.taskIds } },
            data: { sortGroupId: group.id },
          });

          // Per-task difficulty write — plain Prisma calls, no raw SQL.
          // adapter-pg + Prisma.sql/Prisma.join has proven unreliable
          // for this query shape (two separate syntax errors), so this
          // sidesteps it. Bucket sizes are small (bounded by
          // DIFFICULTY_THRESHOLD), so the round-trip cost here is minor.
          await Promise.all(
            bucket.taskIds.map((id, i) =>
              tx.task.update({
                where: { id },
                data: { difficulty: bucket.taskDifficulties[i] },
              }),
            ),
          );

          created.push({
            id: group.id,
            order: group.order,
            difficulty: bucket.difficulty,
            taskIds: bucket.taskIds,
            taskTypes: bucket.taskTypes,
          });
        }

        return created;
      },
      { timeout: 15000, maxWait: 10000 },
    );

    return NextResponse.json({
      label: "done",
      sortGroupId: groups[0]?.id ?? null,
      taskCount: ungroupedTasks.length,
      groups,
    });
  } catch (err) {
    console.error("[sort-group] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}