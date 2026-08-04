// src/app/api/actors/update-actions-table/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { actionsResult } = await req.json();
  const pair = actionsResult?.pair;
  if (!pair?.actionId) {
    return NextResponse.json(
      { error: "actionsResult.pair.actionId is required" },
      { status: 400 },
    );
  }

  try {
    await prisma.action.update({
      where: { id: pair.actionId },
      data: { status: "completed" },
    });

    // pass the pair straight through — atomizerActor reads
    // taskId/atomIndex/taskType off it to decide the next step
    return NextResponse.json({
      label: "done",
      jobId: actionsResult.jobId,
      actionsResult: { label: "done", jobId: actionsResult.jobId, pair },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
