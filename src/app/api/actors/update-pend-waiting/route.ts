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
    await prisma.$transaction([
      prisma.sortGroup.update({
        where: { id: sortGroupId },
        data: { status: "pending" },
      }),
      prisma.task.updateMany({
        where: { sortGroupId },
        data: { status: "pending" },
      }),
    ]);

    return NextResponse.json({ label: "done", sortGroupId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
