// src/lib/rosTopics.ts
export const ROS_TOPICS = {
  visionDetectRequest: "/vision/detect_request",
  visionDetectResponse: "/vision/detect_response",
  actionDispatch: "/action/dispatch",
  actionComplete: "/action/complete",
} as const;