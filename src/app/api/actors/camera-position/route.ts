// src/app/api/actors/camera-position/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Topic } from "roslib";
import type { ActionPair } from "@/machine/actors/types";
import { connectRos } from "@/lib/rosConnect";
import { ROS_TOPICS } from "@/lib/rosTopics";

const DETECTION_TIMEOUT_MS = 10_000;

function toolNameForAtom(atomType: string): string {
  const match = atomType.match(/^pick([A-Z].*)$/);
  if (!match) return atomType;
  return match[1].charAt(0).toLowerCase() + match[1].slice(1);
}

type DetectionResponse = {
  requestId?: unknown;
  x?: unknown;
  y?: unknown;
  distanceMeters?: unknown;
};

function detectToolPosition(
  ros: import("roslib").Ros,
  tool: string,
): Promise<{ x: number; y: number; distanceMeters: number }> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const requestTopic = new Topic({
      ros,
      name: ROS_TOPICS.visionDetectRequest,
      messageType: "std_msgs/String",
    });
    const responseTopic = new Topic({
      ros,
      name: ROS_TOPICS.visionDetectResponse,
      messageType: "std_msgs/String",
    });
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      responseTopic.unsubscribe();
      reject(error);
    };

    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Timed out waiting for detection of "${tool}" (requestId ${requestId})`,
        ),
      );
    }, DETECTION_TIMEOUT_MS);

    responseTopic.subscribe((message: unknown) => {
      const data =
        message && typeof message === "object" && "data" in message
          ? (message as { data?: unknown }).data
          : undefined;
      let payload: DetectionResponse;
      try {
        payload = JSON.parse(typeof data === "string" ? data : "") as DetectionResponse;
      } catch {
        return;
      }

      if (payload.requestId !== requestId) return;
      if (
        typeof payload.x !== "number" ||
        typeof payload.y !== "number" ||
        typeof payload.distanceMeters !== "number"
      ) {
        fail(new Error(`Invalid detection response for "${tool}"`));
        return;
      }

      settled = true;
      clearTimeout(timeout);
      responseTopic.unsubscribe();
      resolve({
        x: payload.x,
        y: payload.y,
        distanceMeters: payload.distanceMeters,
      });
    });

    requestTopic.publish({ data: JSON.stringify({ requestId, tool }) });
  });
}

export async function POST(req: NextRequest) {
  const { job, actionsResult } = await req.json();
  const pair = actionsResult?.pair as ActionPair | undefined;

  if (!job?.id || !Array.isArray(pair) || pair.length === 0) {
    return NextResponse.json(
      { error: "job.id and a non-empty actionsResult.pair are required" },
      { status: 400 },
    );
  }

  let ros;
  try {
    ros = await connectRos();

    const targetIndex =
      pair.findIndex((atom) => atom.actor === "robot") >= 0
        ? pair.findIndex((atom) => atom.actor === "robot")
        : 0;
    const target = pair[targetIndex];
    const tool = toolNameForAtom(target.atomType);
    const position = await detectToolPosition(ros, tool);

    const enrichedPair = pair.map((atom, index) =>
      index === targetIndex
        ? { ...atom, toolLocation: { tool, ...position } }
        : atom,
    );

    return NextResponse.json({
      label: "done",
      jobId: job.id,
      actionsResult: { label: "done", jobId: job.id, pair: enrichedPair },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, rosBridge: true },
      { status: 503 },
    );
  } finally {
    ros?.close();
  }
}