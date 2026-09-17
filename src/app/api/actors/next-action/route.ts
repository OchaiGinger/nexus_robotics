// src/app/api/actors/next-action/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { jobId } = await req.json();

  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    // Strict order: task by task, atom by atom within each task.
    const next = await prisma.action.findFirst({
      where: { jobId, status: "waiting" },
      orderBy: [{ taskId: "asc" }, { atomIndex: "asc" }],
    });

    // No waiting rows left — every action for this batch has been
    // worked through to completion.
    if (!next) {
      return NextResponse.json({
        label: "done",
        jobId,
        route: "allActionsDone",
      });
    }

    // Note: this route does NOT update the row's status. The machine
    // calls updateActionsTableActor with status "pending" as its next
    // step (the updateActionPending state), so all Action status writes
    // stay owned by that one actor.
    return NextResponse.json({
      label: "done",
      jobId,
      route: "action",
      actionId: next.id,
      pair: next.pair,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}