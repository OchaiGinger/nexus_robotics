// src/app/api/actors/ros/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Topic } from "roslib";
import { connectRos } from "@/lib/rosConnect";
import { ROS_TOPICS } from "@/lib/rosTopics";

export async function POST(req: NextRequest) {
  const { job, actionId, source, payload } = await req.json();

  if (!job?.id || !actionId || !source) {
    return NextResponse.json(
      { error: "job.id, actionId, and source are required" },
      { status: 400 },
    );
  }

  let ros;
  try {
    ros = await connectRos();

    const dispatchTopic = new Topic({
      ros,
      name: ROS_TOPICS.actionDispatch,
      messageType: "std_msgs/String",
    });

    dispatchTopic.publish({
      data: JSON.stringify({ actionId, source, payload }),
    });

    return NextResponse.json({
      label: "done",
      jobId: job.id,
      source,
      acked: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, rosBridge: true }, { status: 503 });
  } finally {
    ros?.close();
  }
}