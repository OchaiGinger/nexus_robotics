import type { GraphNode } from "./state-graph-data";

export type FlatActorNode = {
  id: string;
  label: string;
  actor: string;
};

// walks the whole STATE_GRAPH tree and returns every node that actually
// invokes an actor, flattened into a single list — regardless of how
// deeply nested it is (e.g. delegator.middleman.robot.robotActor still
// shows up here as its own entry). Purely structural, no transitions.
export function flattenActors(nodes: GraphNode[]): FlatActorNode[] {
  const out: FlatActorNode[] = [];

  function walk(node: GraphNode) {
    if (node.actor) {
      out.push({ id: node.id, label: node.label, actor: node.actor });
    }
    node.children?.forEach(walk);
  }

  nodes.forEach(walk);
  return out;
}
