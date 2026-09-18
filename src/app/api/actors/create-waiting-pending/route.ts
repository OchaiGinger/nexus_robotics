import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

type AgentLabel =
  | "projectionActor"
  | "angleActor"
  | "gearActor"
  | "polygonActor";

type Step = {
  t: string;
  [key: string]: unknown;
};

type PendingWaitingInput = {
  label: "done";
  jobId: string;
  agent: AgentLabel;
  result: {
    angle?: number;
    quadrant?: number;
    gap?: number;
    from?: string;
    decomp?: { full: unknown[]; gap: unknown[] };
    steps: Step[];
  };
};

export async function POST(req: NextRequest) {
  const input: PendingWaitingInput = await req.json();

  if (!input?.jobId || !input.result?.steps) {
    return NextResponse.json(
      { error: "pending-waiting requires jobId and result.steps" },
      { status: 400 },
    );
  }

  try {
    const requestedCounts = new Map<string, number>();
    for (const step of input.result.steps) {
      requestedCounts.set(step.t, (requestedCounts.get(step.t) ?? 0) + 1);
    }

    const existing = await prisma.task.findMany({
      where: {
        jobId: input.jobId,
        type: { in: [...requestedCounts.keys()] },
      },
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    });

    const existingCounts = new Map<string, number>();
    for (const task of existing) {
      existingCounts.set(task.type, (existingCounts.get(task.type) ?? 0) + 1);
    }

    const missingRows = input.result.steps.filter((step) => {
      const currentCount = existingCounts.get(step.t) ?? 0;
      const requestedCount = requestedCounts.get(step.t) ?? 0;
      if (currentCount < requestedCount) {
        existingCounts.set(step.t, currentCount + 1);
        return true;
      }
      return false;
    });

    if (missingRows.length > 0) {
      await prisma.task.createMany({
        data: missingRows.map((step) => ({
          id: randomUUID(),
          jobId: input.jobId,
          type: step.t,
          payload: step as any,
          status: "waiting",
          sortGroupId: null,
        })),
      });
    }

    const rows = await prisma.task.findMany({
      where: {
        jobId: input.jobId,
        type: { in: [...requestedCounts.keys()] },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      label: "done",
      jobId: input.jobId,
      taskCount: rows.length,
      taskIds: rows.map((r) => r.id),
    });
  } catch (err) {
    console.error("[create-waiting-pending] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}