// src/app/api/actors/camera-position/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as ROSLIB from "roslib";
const RosLib: any = ROSLIB;
// roslib's type declarations don't reliably match its runtime shape —
// bypassing strict typing here rather than fighting mismatched .d.ts
// files property by property.

const REQUEST_TOPIC = "/vision/detect_request";
const RESPONSE_TOPIC = "/vision/detect_response";
const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL ?? "ws://localhost:9090";
const DETECTION_TIMEOUT_MS = 10_000;

function toolNameForAtom(atomType: string): string {
  const match = atomType.match(/^pick([A-Z].*)$/);
  if (!match) return atomType;
  return match[1].charAt(0).toLowerCase() + match[1].slice(1);
}

function detectToolPosition(
  ros: any,
  tool: string,
): Promise<{ x: number; y: number; distanceMeters: number }> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const requestTopic = new ROSLIB.Topic({
      ros,
      name: REQUEST_TOPIC,
      messageType: "std_msgs/String",
    });

    const responseTopic = new ROSLIB.Topic({
      ros,
      name: RESPONSE_TOPIC,
      messageType: "std_msgs/String",
    });

    const timeout = setTimeout(() => {
      responseTopic.unsubscribe();
      reject(
        new Error(
          `Timed out waiting for detection of "${tool}" (requestId ${requestId})`,
        ),
      );
    }, DETECTION_TIMEOUT_MS);

    responseTopic.subscribe((message: any) => {
      let payload: any;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      if (payload.requestId !== requestId) return;

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
  const pair = actionsResult?.pair;

  if (!job?.id || !pair?.atomType) {
    return NextResponse.json(
      { error: "job.id and actionsResult.pair.atomType are required" },
      { status: 400 },
    );
  }

  const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });

  try {
    await new Promise<void>((resolve, reject) => {
      ros.on("connection", () => resolve());
      ros.on("error", (err: unknown) => reject(err));
    });

    const tool = toolNameForAtom(pair.atomType);
    const position = await detectToolPosition(ros, tool);

    const enrichedPair = { ...pair, toolLocation: { tool, ...position } };

    return NextResponse.json({
      label: "done",
      jobId: job.id,
      actionsResult: { label: "done", jobId: job.id, pair: enrichedPair },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  } finally {
    ros.close();
  }
}
