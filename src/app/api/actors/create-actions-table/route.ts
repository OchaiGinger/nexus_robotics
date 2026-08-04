// src/app/api/actors/create-actions-table/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { jobId, pair } = await req.json();
  if (!jobId || !pair?.taskId) {
    return NextResponse.json(
      { error: "jobId and pair.taskId are required" },
      { status: 400 },
    );
  }

  try {
    const action = await prisma.action.create({
      data: {
        jobId,
        taskId: pair.taskId,
        atomIndex: pair.atomIndex,
        atomType: pair.atomType,
        pair,
        status: "pending",
      },
    });

    // embed actionId into the pair so updateActionsTableActor can find
    // this row later, without needing any new context fields
    return NextResponse.json({
      label: "done",
      jobId,
      pair: { ...pair, actionId: action.id },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
