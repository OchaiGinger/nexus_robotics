// src/lib/rosConnect.ts
import { Ros } from "roslib";

export function normalizeRosUrl(url: string): string {
  return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export const ROSBRIDGE_URL = normalizeRosUrl(
  process.env.ROSBRIDGE_URL ?? process.env.ROS_BRIDGE_URL ?? "ws://localhost:9090",
);

export function connectRos(timeoutMs = 5_000): Promise<Ros> {
  const ros = new Ros({ url: ROSBRIDGE_URL });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ros.off("connection", onConnection);
      ros.off("error", onError);
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
      reject(error);
    };

    ros.on("connection", onConnection);
    ros.on("error", onError);
  });
}