// src/app/api/actors/create-actions-table/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { jobId, actions } = await req.json();

  if (!jobId || !Array.isArray(actions)) {
    return NextResponse.json(
      { error: "jobId and actions[] are required" },
      { status: 400 },
    );
  }

  try {
    await prisma.action.createMany({
      data: actions.map((a: { taskId: string; atomIndex: number; atomType: string; pair: unknown }) => ({
        jobId,
        taskId: a.taskId,
        atomIndex: a.atomIndex,
        atomType: a.atomType,
        pair: a.pair as any,
        status: "waiting",
      })),
    });

    return NextResponse.json({ label: "done", jobId, count: actions.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}