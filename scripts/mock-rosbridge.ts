// scripts/mock-rosbridge.ts
import { WebSocketServer, WebSocket } from "ws";
import { ROS_TOPICS } from "../src/lib/rosTopics";

const wss = new WebSocketServer({ port: 9090 });
console.log("Mock rosbridge listening on ws://localhost:9090");

function broadcast(message: unknown) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.op === "advertise" || msg.op === "subscribe") return;

    if (msg.op === "publish") {
      const { topic, msg: payload } = msg;

      if (topic === ROS_TOPICS.visionDetectRequest) {
        const data = JSON.parse(payload.data);
        setTimeout(() => {
          broadcast({
            op: "publish",
            topic: ROS_TOPICS.visionDetectResponse,
            msg: { data: JSON.stringify({ requestId: data.requestId, x: 0.42, y: 0.13, distanceMeters: 0.35 }) },
          });
        }, 300);
      }

      if (topic === ROS_TOPICS.actionDispatch) {
        const data = JSON.parse(payload.data);
        setTimeout(() => {
          broadcast({
            op: "publish",
            topic: ROS_TOPICS.actionComplete,
            msg: { data: JSON.stringify({ actionId: data.actionId, source: data.source, result: { ok: true } }) },
          });
        }, 500);
      }
    }
  });
});