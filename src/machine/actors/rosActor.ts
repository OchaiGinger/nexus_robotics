// src/actors/rosActor.ts
//
// Previously: publish to /action/dispatch, resolve immediately on a
// successful publish call (not a delivery ack), and rely on a LATER,
// separate actor (validatorActor, via /api/actors/validate) to subscribe
// to /action/complete and catch the eventual reply.
//
// That gap between "dispatch published" and "validator subscribes" is a
// real race: dispatch_node can process and publish its completion back
// before validator's later HTTP round-trip + connectRos() + subscribe
// ever happens. rosbridge doesn't buffer messages for late subscribers,
// so a completion published into an empty room is lost forever — which
// is indistinguishable from "nothing ever happened" and manifests as a
// clean 30s timeout with no errors anywhere.
//
// Fix: subscribe to this action+source's completion FIRST, then publish
// the dispatch, then wait. No gap, no race. validatorActor no longer
// needs to listen on ROS at all — it just validates whatever result
// this actor already captured.

import { fromPromise } from "xstate";
import { Topic } from "roslib";
import { connectRos } from "@/lib/rosConnect";

const DISPATCH_TOPIC = "/action/dispatch";
const COMPLETION_TOPIC = "/action/complete";
const COMPLETION_TIMEOUT_MS = 30_000;

type RosActorInput = {
  job: { id: string; payload: unknown };
  actionId: string;
  source: "robot" | "human";
  payload: unknown;
};

type RosActorOutput = {
  label: "done";
  jobId: string;
  source: "robot" | "human";
  acked: true;
  result: unknown;
};

type CompletionMessage = {
  actionId?: unknown;
  source?: unknown;
  result?: unknown;
};

export const rosActor = fromPromise<RosActorOutput, RosActorInput>(
  async ({ input }) => {
    const { job, actionId, source, payload } = input;
    if (!job) throw new Error("rosActor requires a job");
    if (!actionId) throw new Error("rosActor requires an actionId");

    const ros = await connectRos();

    try {
      const completionTopic = new Topic({
        ros,
        name: COMPLETION_TOPIC,
        messageType: "std_msgs/String",
      });

      const result = await new Promise<unknown>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          completionTopic.unsubscribe();
          reject(
            new Error(
              `rosActor: timed out waiting for ${source} completion on action ${actionId}`,
            ),
          );
        }, COMPLETION_TIMEOUT_MS);

        // Subscribe BEFORE publishing — this is the whole fix.
        completionTopic.subscribe((message: unknown) => {
          if (settled) return;
          const data =
            message && typeof message === "object" && "data" in message
              ? (message as { data?: unknown }).data
              : undefined;
          let parsed: CompletionMessage;
          try {
            parsed = JSON.parse(typeof data === "string" ? data : "") as CompletionMessage;
          } catch {
            return;
          }
          if (parsed.actionId !== actionId) return;
          if (parsed.source !== source) return;

          settled = true;
          clearTimeout(timeout);
          completionTopic.unsubscribe();
          resolve(parsed.result);
        });

        // Now publish, only after the subscription is live.
        const dispatchTopic = new Topic({
          ros,
          name: DISPATCH_TOPIC,
          messageType: "std_msgs/String",
        });
        dispatchTopic.publish({
          data: JSON.stringify({ actionId, source, payload }),
        } as any);
      });

      return {
        label: "done",
        jobId: job.id,
        source,
        acked: true,
        result,
      };
    } finally {
      ros.close();
    }
  },
);