// src/lib/rosBridge.ts
// Placeholder until the real ROS bridge (rosbridge/rclnodejs/etc.) is
// wired in. Two links out (robot publish, human publish), one link in
// (validator subscribes for completion of either/both).

type RosSource = "robot" | "human";

type CompletionEvent = {
  actionId: string;
  source: RosSource;
  result: unknown;
};

// In-memory pub/sub for now — swap for a real ROS topic subscription
// once the bridge exists. Keyed by actionId so multiple in-flight
// actions (shouldn't normally overlap, but safe either way) don't
// cross-talk.
const listeners = new Map<string, Array<(event: CompletionEvent) => void>>();

export async function publishToRos(
  actionId: string,
  source: RosSource,
  payload: unknown,
): Promise<{ acked: true }> {
  // Replace with a real publish call. For now, simulate ROS finishing
  // the action shortly after publish so the listener side has something
  // to receive during local development.
  setTimeout(() => {
    const subs = listeners.get(actionId) ?? [];
    for (const fn of subs) fn({ actionId, source, result: {} });
  }, 500);

  return { acked: true };
}

export function waitForCompletion(
  actionId: string,
  sources: RosSource[],
  timeoutMs = 30000,
): Promise<Record<RosSource, unknown>> {
  return new Promise((resolve, reject) => {
    const received: Partial<Record<RosSource, unknown>> = {};

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForCompletion: timed out waiting for ${sources.join("+")} on action ${actionId}`));
    }, timeoutMs);

    const handler = (event: CompletionEvent) => {
      if (event.actionId !== actionId) return;
      received[event.source] = event.result;

      if (sources.every((s) => s in received)) {
        cleanup();
        resolve(received as Record<RosSource, unknown>);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      const subs = listeners.get(actionId) ?? [];
      listeners.set(actionId, subs.filter((fn) => fn !== handler));
    };

    const subs = listeners.get(actionId) ?? [];
    subs.push(handler);
    listeners.set(actionId, subs);
  });
}