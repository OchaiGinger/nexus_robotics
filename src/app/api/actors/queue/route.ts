import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type JobType = "projectionAgent" | "angleAgent" | "gearAgent" | "polygonAgent";

type QueueActorInput = {
  origin: "newJob" | "nextBatch";
  job?: {
    id: string;
    type: JobType;
    payload: unknown;
  };
  sortGroupId?: string;
};

type QueueActorOutput =
  | { label: "newJob"; job: NonNullable<QueueActorInput["job"]> }
  | { label: "nextBatch"; sortGroupId: string };

export async function POST(req: NextRequest) {
  const input: QueueActorInput = await req.json();

  try {
    if (input.origin === "newJob") {
      if (!input.job) {
        return NextResponse.json(
          { error: "newJob origin requires a job payload" },
          { status: 400 },
        );
      }

      await prisma.task.create({
        data: {
          id: input.job.id,
          jobId: input.job.id,
          type: input.job.type,
          payload: input.job.payload as any,
          status: "intake",
          sortGroupId: null,
        },
      });

      const output: QueueActorOutput = { label: "newJob", job: input.job };
      return NextResponse.json(output);
    }

    if (input.origin === "nextBatch") {
      if (!input.sortGroupId) {
        return NextResponse.json(
          { error: "nextBatch origin requires a sortGroupId" },
          { status: 400 },
        );
      }

      const nextSortGroupId = await prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { sortGroupId: input.sortGroupId, status: "pending" },
          data: { status: "completed" },
        });

        const current = await tx.sortGroup.update({
          where: { id: input.sortGroupId },
          data: { status: "completed" },
        });

        const next = await tx.sortGroup.findFirst({
          where: { order: { gt: current.order }, status: "waiting" },
          orderBy: { order: "asc" },
        });

        if (!next) {
          throw new Error(
            `No next sort group found after ${input.sortGroupId}`,
          );
        }

        await tx.sortGroup.update({
          where: { id: next.id },
          data: { status: "pending" },
        });

        await tx.task.updateMany({
          where: { sortGroupId: input.sortGroupId },
          data: { status: "completed" },
        });

        return next.id;
      });

      const output: QueueActorOutput = {
        label: "nextBatch",
        sortGroupId: nextSortGroupId,
      };
      return NextResponse.json(output);
    }

    return NextResponse.json(
      { error: `Unknown origin: ${(input as any).origin}` },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
