// src/app/api/actors/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Topic } from "roslib";
import { prisma } from "@/lib/prisma";
import { connectRos } from "@/lib/rosConnect";

const COMPLETION_TOPIC = "/action/complete";
const COMPLETION_TIMEOUT_MS = 30_000;

type CompletionMessage = {
  actionId?: unknown;
  source?: unknown;
  result?: unknown;
};

function waitForSources(
  ros: import("roslib").Ros,
  actionId: string,
  sources: Array<"robot" | "human">,
): Promise<Record<"robot" | "human", unknown>> {
  return new Promise((resolve, reject) => {
    const received: Partial<Record<"robot" | "human", unknown>> = {};
    const topic = new Topic({ ros, name: COMPLETION_TOPIC, messageType: "std_msgs/String" });
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      topic.unsubscribe();
      reject(error);
    };

    const timeout = setTimeout(() => {
      fail(new Error(`Timed out waiting for ${sources.join("+")} completion on action ${actionId}`));
    }, COMPLETION_TIMEOUT_MS);

    topic.subscribe((message: unknown) => {
      const data =
        message && typeof message === "object" && "data" in message
          ? (message as { data?: unknown }).data
          : undefined;
      let payload: CompletionMessage;
      try {
        payload = JSON.parse(typeof data === "string" ? data : "") as CompletionMessage;
      } catch {
        return;
      }

      if (payload.actionId !== actionId) return;
      if (payload.source !== "robot" && payload.source !== "human") return;

      received[payload.source] = payload.result;

      if (sources.every((s) => s in received)) {
        settled = true;
        clearTimeout(timeout);
        topic.unsubscribe();
        resolve(received as Record<"robot" | "human", unknown>);
      }
    });
  });
}

// replace with real robot-result validation logic
async function checkRobotResult(job: { id: string }, robotResult: unknown): Promise<boolean> {
  return true;
}

// replace with real human-result validation logic
async function checkHumanResult(job: { id: string }, humanResult: unknown): Promise<boolean> {
  return true;
}

export async function POST(req: NextRequest) {
  const { job, actionId, mode, role } = await req.json();

  if (!job?.id || !actionId) {
    return NextResponse.json({ error: "job.id and actionId are required" }, { status: 400 });
  }
  if (mode === "single" && !role) {
    return NextResponse.json({ error: "role is required when mode is 'single'" }, { status: 400 });
  }

  let ros;
  try {
    ros = await connectRos();

    const sources: Array<"robot" | "human"> = mode === "both" ? ["robot", "human"] : [role];
    const results = await waitForSources(ros, actionId, sources);

    const robotCorrect = sources.includes("robot") ? await checkRobotResult(job, results.robot) : true;
    const humanCorrect = sources.includes("human") ? await checkHumanResult(job, results.human) : true;
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, rosBridge: true }, { status: 503 });
  } finally {
    ros?.close();
  }
}