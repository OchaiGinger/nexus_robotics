import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type AgentLabel =
  | "projectionActor"
  | "angleActor"
  | "gearActor"
  | "polygonActor";

type AgentStep = {
  type: string;
  difficulty: number;
  payload: unknown;
};

type PendingWaitingInput = {
  label: "done";
  jobId: string;
  agent: AgentLabel;
  result: AgentStep[];
};

export async function POST(req: NextRequest) {
  const input: PendingWaitingInput = await req.json();

  if (!input?.jobId || !Array.isArray(input.result)) {
    return NextResponse.json(
      { error: "pending-waiting requires jobId and an array result" },
      { status: 400 },
    );
  }

  try {
    const taskIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      for (const step of input.result) {
        const task = await tx.task.create({
          data: {
            jobId: input.jobId,
            type: step.type,
            // difficulty lives inside payload for now — no dedicated
            // column on Task yet
            payload: {
              ...(step.payload as object),
              difficulty: step.difficulty,
            } as any,
            status: "waiting",
            sortGroupId: null,
          },
        });
        ids.push(task.id);
      }

      return ids;
    });

    return NextResponse.json({
      label: "done",
      jobId: input.jobId,
      taskIds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
