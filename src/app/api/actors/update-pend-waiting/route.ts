// src/app/api/actors/update-pend-waiting/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { sortGroupId } = await req.json();
  if (!sortGroupId)
    return NextResponse.json(
      { error: "sortGroupId is required" },
      { status: 400 },
    );

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.sortGroup.update({
        where: { id: sortGroupId },
        data: { status: "pending" },
      });

      const tasks = await tx.task.updateMany({
        where: { sortGroupId },
        data: { status: "pending" },
      });

      const taskIds = await tx.task.findMany({
        where: { sortGroupId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });

      return { count: tasks.count, taskIds: taskIds.map((t) => t.id) };
    });

    return NextResponse.json({
      label: "done",
      sortGroupId,
      taskCount: result.count,
      taskIds: result.taskIds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
