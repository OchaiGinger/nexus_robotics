// src/lib/rosConnect.ts
import { Ros } from "roslib";

export function normalizeRosUrl(url: string): string {
  return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export const ROSBRIDGE_URL = normalizeRosUrl(
  process.env.ROSBRIDGE_URL ?? process.env.ROS_BRIDGE_URL ?? "ws://localhost:9090",
);

// Extracts whatever useful info we can from a raw ws/browser error event.
// roslib's Ros instance re-emits the underlying WebSocket's native 'error'
// event verbatim, which (per spec) carries no .message — just type: 'error'.
// Left unwrapped, `reject(error)` on that object produces "Unknown error"
// everywhere downstream (route handler, validatorActor, machine logs),
// which made a plain "rosbridge is unreachable" indistinguishable from any
// other failure. This always produces a real Error with a diagnosable message.
function describeRosError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    if (typeof anyErr.message === "string" && anyErr.message) return anyErr.message;
    if (typeof anyErr.type === "string") return `WebSocket ${anyErr.type} event (no further detail — connection likely refused or unreachable)`;
  }
  return "Unknown ROS connection error";
}

export function connectRos(timeoutMs = 5_000): Promise<Ros> {
  const ros = new Ros({ url: ROSBRIDGE_URL });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ros.off("connection", onConnection);
      ros.off("error", onError);
      ros.close();
      reject(new Error(`Timed out connecting to ROS bridge at ${ROSBRIDGE_URL}`));
    }, timeoutMs);

    const onConnection = () => {
      clearTimeout(timeout);
      ros.off("error", onError);
      resolve(ros);
    };
    const onError = (error: unknown) => {
      clearTimeout(timeout);
      ros.off("connection", onConnection);
      ros.close();
      reject(
        new Error(
          `Failed to connect to ROS bridge at ${ROSBRIDGE_URL}: ${describeRosError(error)}`,
        ),
      );
    };

    ros.on("connection", onConnection);
    ros.on("error", onError);
  });
}