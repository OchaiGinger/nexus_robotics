// src/app/api/actors/update-actions-table/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { actionId, status } = await req.json();

  if (!actionId || !status) {
    return NextResponse.json(
      { error: "actionId and status are required" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.action.update({
      where: { id: actionId },
      data: { status },
    });

    return NextResponse.json({
      label: "done",
      actionId,
      status: updated.status,
      pair: updated.pair,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}