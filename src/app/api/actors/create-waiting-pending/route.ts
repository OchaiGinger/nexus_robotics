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
    // Generate ids up front so we can return them — createMany doesn't
    // return the created rows.
    const rows = input.result.steps.map((step) => ({
      id: randomUUID(),
      jobId: input.jobId,
      type: step.t,
      payload: step as any,
      status: "waiting",
      sortGroupId: null,
    }));

    await prisma.task.createMany({ data: rows });

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