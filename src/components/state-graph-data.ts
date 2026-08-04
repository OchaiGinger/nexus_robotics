// state-graph-data.ts — unchanged except EDGES now carries a stable id
export type GraphNode = {
  id: string;
  label: string;
  actor?: string;
  children?: GraphNode[];
};

export type GraphEdge = {
  id: string; // unique — was missing, caused the duplicate-key crash
  from: string;
  to: string;
  label?: string;
  kind?: "loop" | "retry" | "error"; // styling hint
};

export const STATE_GRAPH: GraphNode[] = [
  { id: "idle", label: "Idle" },
  { id: "orchestrator", label: "Orchestrator", actor: "ochestratorActor" },
  { id: "cue", label: "Cue", actor: "queueActor" },
  { id: "cueError", label: "Cue Error" },
  { id: "tool", label: "Tool", actor: "toolSmithActor" },
  { id: "toolAppend", label: "Tool Append", actor: "toolAppendActor" },
  { id: "validateJobActor", label: "Validate Job", actor: "validateJobActor" },
  {
    id: "projectionAgent",
    label: "Projection Agent",
    actor: "projectionActor",
  },
  { id: "angleAgent", label: "Angle Agent", actor: "angleActor" },
  { id: "gearAgent", label: "Gear Agent", actor: "gearActor" },
  { id: "polygonAgent", label: "Polygon Agent", actor: "polygonActor" },
  {
    id: "agentResult",
    label: "Agent Result",
    actor: "createWaitingPendingActor",
  },
  { id: "sortGroup", label: "Sort Group", actor: "sortGroupActor" },
  {
    id: "advanceBatch",
    label: "Advance Batch",
    actor: "updatePendWaitingActor",
  },
  {
    id: "director",
    label: "Director",
    children: [
      { id: "director.atomize", label: "Atomize", actor: "atomizerActor" },
      {
        id: "director.createActionsTable",
        label: "Create Actions Table",
        actor: "createActionsTableActor",
      },
    ],
  },
  {
    id: "delegator",
    label: "Delegator",
    children: [
      {
        id: "delegator.cameraPosition",
        label: "Camera Position",
        actor: "cameraPositionActor",
      },
      { id: "delegator.delegate", label: "Delegate", actor: "delegatorActor" },
      {
        id: "delegator.robotBranch",
        label: "Robot branch",
        children: [
          {
            id: "delegator.robotBranch.robotActor",
            label: "Robot Actor",
            actor: "robotActor",
          },
          {
            id: "delegator.robotBranch.rosActor",
            label: "ROS Actor",
            actor: "rosActor (robot)",
          },
        ],
      },
      {
        id: "delegator.humanBranch",
        label: "Human branch",
        children: [
          {
            id: "delegator.humanBranch.humanActor",
            label: "Human Actor",
            actor: "humanActor",
          },
          {
            id: "delegator.humanBranch.humanInterpreterActor",
            label: "Human Interpreter",
            actor: "humanInterpreterActor",
          },
          {
            id: "delegator.humanBranch.rosActor",
            label: "ROS Actor",
            actor: "rosActor (human)",
          },
        ],
      },
      {
        id: "delegator.validator",
        label: "Validator",
        actor: "validatorActor",
      },
      {
        id: "delegator.updateActionsTable",
        label: "Update Actions Table",
        actor: "updateActionsTableActor",
      },
      { id: "delegator.validatorError", label: "Validator Error" },
      { id: "delegator.executionError", label: "Execution Error" },
    ],
  },
];

export const EDGES: GraphEdge[] = [
  { id: "e1", from: "idle", to: "orchestrator", label: "new_job" },
  { id: "e2", from: "orchestrator", to: "cue", label: "isNextBatch" },
  { id: "e3", from: "orchestrator", to: "tool", label: "isTask" },
  { id: "e4", from: "orchestrator", to: "idle", label: "isDone" },
  { id: "e5", from: "orchestrator", to: "director", label: "isTools" },
  { id: "e6", from: "orchestrator", to: "cue", label: "isNewJob" },
  { id: "e7", from: "cue", to: "validateJobActor", label: "isNewJobFromQueue" },
  { id: "e8", from: "cue", to: "advanceBatch", label: "isNextBatchFromQueue" },
  { id: "e9", from: "cue", to: "cueError", label: "else/error", kind: "error" },
  { id: "e10", from: "cueError", to: "idle", label: "always", kind: "loop" },
  { id: "e11", from: "tool", to: "toolAppend", label: "onDone" },
  { id: "e12", from: "toolAppend", to: "orchestrator", label: "onDone" },
  { id: "e13", from: "toolAppend", to: "tool", label: "retry", kind: "retry" },
  {
    id: "e14",
    from: "validateJobActor",
    to: "projectionAgent",
    label: "projectionAgent",
  },
  {
    id: "e15",
    from: "validateJobActor",
    to: "angleAgent",
    label: "angleAgent",
  },
  { id: "e16", from: "validateJobActor", to: "gearAgent", label: "gearAgent" },
  {
    id: "e17",
    from: "validateJobActor",
    to: "polygonAgent",
    label: "polygonAgent",
  },
  { id: "e18", from: "projectionAgent", to: "agentResult", label: "onDone" },
  { id: "e19", from: "angleAgent", to: "agentResult", label: "onDone" },
  { id: "e20", from: "gearAgent", to: "agentResult", label: "onDone" },
  { id: "e21", from: "polygonAgent", to: "agentResult", label: "onDone" },
  { id: "e22", from: "agentResult", to: "sortGroup", label: "onDone" },
  { id: "e23", from: "sortGroup", to: "advanceBatch", label: "onDone" },
  {
    id: "e24",
    from: "advanceBatch",
    to: "orchestrator",
    label: "onDone",
    kind: "loop",
  },
  {
    id: "e25",
    from: "director.atomize",
    to: "director.createActionsTable",
    label: "isAtomizerActions",
  },
  {
    id: "e26",
    from: "director.atomize",
    to: "director.atomize",
    label: "moreTasks",
    kind: "loop",
  },
  {
    id: "e27",
    from: "director.atomize",
    to: "orchestrator",
    label: "allTasksDone",
    kind: "loop",
  },
  {
    id: "e28",
    from: "director.createActionsTable",
    to: "delegator.cameraPosition",
    label: "onDone",
  },
  {
    id: "e29",
    from: "delegator.cameraPosition",
    to: "delegator.delegate",
    label: "onDone",
  },
  {
    id: "e30",
    from: "delegator.delegate",
    to: "delegator.robotBranch.robotActor",
    label: "isRobotAction",
  },
  {
    id: "e31",
    from: "delegator.delegate",
    to: "delegator.humanBranch.humanActor",
    label: "isHumanAction",
  },
  {
    id: "e32",
    from: "delegator.robotBranch.robotActor",
    to: "delegator.robotBranch.rosActor",
    label: "onDone",
  },
  {
    id: "e33",
    from: "delegator.robotBranch.rosActor",
    to: "delegator.validator",
    label: "onDone",
  },
  {
    id: "e34",
    from: "delegator.humanBranch.humanActor",
    to: "delegator.humanBranch.humanInterpreterActor",
    label: "onDone",
  },
  {
    id: "e35",
    from: "delegator.humanBranch.humanInterpreterActor",
    to: "delegator.humanBranch.rosActor",
    label: "onDone",
  },
  {
    id: "e36",
    from: "delegator.humanBranch.rosActor",
    to: "delegator.validator",
    label: "onDone",
  },
  {
    id: "e37",
    from: "delegator.validator",
    to: "delegator.updateActionsTable",
    label: "valid",
  },
  {
    id: "e38",
    from: "delegator.validator",
    to: "delegator.delegate",
    label: "invalid → retry",
    kind: "retry",
  },
  {
    id: "e39",
    from: "delegator.updateActionsTable",
    to: "director.atomize",
    label: "onDone",
    kind: "loop",
  },
  {
    id: "e40",
    from: "delegator.validatorError",
    to: "orchestrator",
    label: "always",
    kind: "error",
  },
  {
    id: "e41",
    from: "delegator.executionError",
    to: "orchestrator",
    label: "always",
    kind: "error",
  },
];

export function flattenStateValue(
  value: unknown,
  prefix: string[] = [],
): string[] {
  if (typeof value === "string") return [[...prefix, value].join(".")];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, sub]) => flattenStateValue(sub, [...prefix, key]),
    );
  }
  return [prefix.join(".")];
}

export function expandToPrefixes(leafPaths: string[]): Set<string> {
  const all = new Set<string>();
  for (const leaf of leafPaths) {
    const parts = leaf.split(".");
    for (let i = 1; i <= parts.length; i++)
      all.add(parts.slice(0, i).join("."));
  }
  return all;
}

export function flattenActors(
  nodes: GraphNode[],
): { id: string; label: string; actor?: string }[] {
  const out: { id: string; label: string; actor?: string }[] = [];
  const walk = (list: GraphNode[]) => {
    for (const n of list) {
      out.push({ id: n.id, label: n.label, actor: n.actor });
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
