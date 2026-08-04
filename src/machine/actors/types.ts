// e.g. in a shared types file, actors/types.ts
export type ActionPair = {
  atomType: string;
  toolLocation?: {
    tool: string;
    x: number;
    y: number;
    distanceMeters: number;
  };
  role?: "robot" | "human"; // set by delegatorActor
  // add other fields as cameraPositionActor/delegatorActor enrich the pair
};
