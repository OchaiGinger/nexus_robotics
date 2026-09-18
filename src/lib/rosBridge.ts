// src/lib/rosBridge.ts
//
// Was a placeholder in-memory pub/sub with no connection to the real ROS
// graph at all — publishToRos() just scheduled a setTimeout and fired
// listeners local to this module's own Map. Nothing about it touched
// roslib or the rosbridge WebSocket. Meanwhile src/app/api/actors/validate/route.ts
// has its own SEPARATE real roslib.Topic subscription against actual
// rosbridge. Those two systems never talked to each other: dispatch_node
// never received anything real, so it never published a real completion
// message, so the real subscriber in validate/route.ts always timed out
// after the full COMPLETION_TIMEOUT_MS with no errors anywhere.
//
// This version publishes for real, over the same rosbridge connection
// validate/route.ts uses (via connectRos), to whatever topic dispatch_node
// actually subscribes to.
//
// IMPORTANT: confirm DISPATCH_TOPIC and the message shape below against
// dispatch_node's actual subscription (topic name + message type +
// expected JSON fields). This assumes /action/dispatch as std_msgs/String
// with a JSON string payload, mirroring the shape validate/route.ts
// already expects back on /action/complete — update if dispatch_node
// expects something else.

import { Topic } from "roslib";
import { connectRos } from "@/lib/rosConnect";

const DISPATCH_TOPIC = "/action/dispatch";

type RosSource = "robot" | "human";

export async function publishToRos(
  actionId: string,
  source: RosSource,
  payload: unknown,
): Promise<{ acked: true }> {
  const ros = await connectRos();
  try {
    const topic = new Topic({
      ros,
      name: DISPATCH_TOPIC,
      messageType: "std_msgs/String",
    });

    topic.publish({
      data: JSON.stringify({ actionId, source, payload }),
    } as any);

    // rosbridge publish is fire-and-forget at the protocol level — there's
    // no built-in delivery ack. "acked: true" here only means the publish
    // call was sent over an open connection without throwing, not that
    // dispatch_node received or is acting on it. If you need a real ack,
    // that has to come from dispatch_node explicitly responding (e.g. a
    // service call, or a dedicated ack topic) rather than being inferred
    // from the publish call succeeding.
    return { acked: true };
  } finally {
    ros.close();
  }
}