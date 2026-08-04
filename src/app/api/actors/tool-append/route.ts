// src/app/api/actors/tool-append/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// CONFIRMED (from your instructions): verticalLine, horizontalLine, circle.
// ASSUMED: angleLine and bisector — not specified, inferred as reasonable
// construction tools. Correct these if wrong.
const TOOLS_BY_TASK_TYPE: Record<string, string[]> = {
  baseline: ["ruler", "pencil"],
  horizontalLine: ["ruler", "pencil"],
  verticalLine: ["set square", "ruler", "pencil"],
  circle: ["compass", "ruler", "set square"],
  angleLine: ["protractor", "ruler", "pencil"], // ASSUMED
  bisector: ["compass", "ruler", "pencil"], // ASSUMED
};

export async function POST(req: NextRequest) {
  const toolResult = await req.json();

  if (!toolResult?.jobId || !Array.isArray(toolResult.tools)) {
    return NextResponse.json(
      { error: "toolResult must include jobId and a tools array of tasks" },
      { status: 400 },
    );
  }

  try {
    await Promise.all(
      toolResult.tools.map((task: { id: string; type: string }) =>
        prisma.task.update({
          where: { id: task.id },
          data: { tools: TOOLS_BY_TASK_TYPE[task.type] ?? [] },
        }),
      ),
    );

    return NextResponse.json({ label: "done", jobId: toolResult.jobId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
