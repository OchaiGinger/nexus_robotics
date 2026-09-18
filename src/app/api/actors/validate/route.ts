// src/app/api/actors/validate/route.ts
//
// No longer subscribes to ROS at all. That responsibility moved into
// rosActor, which now subscribes to its own completion BEFORE publishing
// dispatch (eliminating the publish-before-subscribe race this route
// previously had). This route now does pure business-logic validation
// on results that already exist in context by the time it's called.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// replace with real robot-result validation logic
async function checkRobotResult(job: { id: string }, robotResult: unknown): Promise<boolean> {
  return true;
}

// replace with real human-result validation logic
async function checkHumanResult(job: { id: string }, humanResult: unknown): Promise<boolean> {
  return true;
}

export async function POST(req: NextRequest) {
  const { job, actionId, mode, role, robotResult, humanResult } = await req.json();

  if (!job?.id || !actionId) {
    return NextResponse.json({ error: "job.id and actionId are required" }, { status: 400 });
  }
  if (mode === "single" && !role) {
    return NextResponse.json({ error: "role is required when mode is 'single'" }, { status: 400 });
  }

  try {
    const sources: Array<"robot" | "human"> = mode === "both" ? ["robot", "human"] : [role];

    const robotCorrect = sources.includes("robot")
      ? await checkRobotResult(job, robotResult)
      : true;
    const humanCorrect = sources.includes("human")
      ? await checkHumanResult(job, humanResult)
      : true;
    const valid = robotCorrect && humanCorrect;

    if (valid) {
      await prisma.action.update({ where: { id: actionId }, data: { status: "completed" } });
    }

    return NextResponse.json({
      label: "done",
      jobId: job.id,
      actionId,
      robotCorrect,
      humanCorrect,
      valid,
    });
  } catch (err) {
    console.error("[validate route] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}