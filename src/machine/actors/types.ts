export type PairAtom = {
  actor: "robot" | "human";
  atomType: string;
  values?: unknown;
  toolLocation?: {
    tool: string;
    x: number;
    y: number;
    distanceMeters: number;
  };
};

export type ActionPair = PairAtom[];
