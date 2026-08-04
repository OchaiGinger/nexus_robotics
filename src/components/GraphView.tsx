"use client";

import { NodeCard } from "./NodeCard";
import type { NodeLog } from "@/app/context/machine-context";

const LANE_STYLE: React.CSSProperties = {
  border: "1px dashed #d1d5db",
  borderRadius: 12,
  padding: "16px 20px",
  position: "relative",
};

const LANE_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 12,
};

function Arrow({
  label,
  vertical = false,
}: {
  label?: string;
  vertical?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        gap: 4,
        color: "#9ca3af",
        fontSize: 10,
        padding: vertical ? "4px 0" : "0 4px",
        flexShrink: 0,
      }}
    >
      {label && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
      <span style={{ fontSize: 16 }}>{vertical ? "↓" : "→"}</span>
    </div>
  );
}

function LoopBadge({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: "#b45309",
        background: "#fef3c7",
        border: "1px solid #fde68a",
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      ↺ {label}
    </div>
  );
}

export function GraphView({ nodeLog }: { nodeLog: NodeLog }) {
  const n = (id: string, label: string, actor?: string, compact = false) => (
    <NodeCard
      id={id}
      label={label}
      actor={actor}
      nodeLog={nodeLog}
      compact={compact}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* LANE 1 — job lifecycle */}
      <div style={LANE_STYLE}>
        <div style={LANE_TITLE}>Job lifecycle</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          {n("idle", "Idle")}
          <Arrow label="new_job" />
          {n("orchestrator", "Orchestrator", "ochestratorActor")}
          <Arrow label="isNewJob/isNextBatch" />
          {n("cue", "Cue", "queueActor")}
          <Arrow label="new job" />
          {n("validateJobActor", "Validate Job", "validateJobActor")}
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 8, marginLeft: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              if invalid queue result →
            </span>
            {n("cueError", "Cue Error")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#9ca3af" }}>if isTask →</span>
            {n("tool", "Tool", "toolSmithActor")}
            <Arrow />
            {n("toolAppend", "Tool Append", "toolAppendActor")}
            <LoopBadge label="→ orchestrator" />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <LoopBadge label="isTools → Director lane below" />
        </div>
      </div>

      {/* LANE 2 — agent fan-out */}
      <div style={LANE_STYLE}>
        <div style={LANE_TITLE}>Agent fan-out (from Validate Job)</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {n("projectionAgent", "Projection Agent", "projectionActor", true)}
            {n("angleAgent", "Angle Agent", "angleActor", true)}
            {n("gearAgent", "Gear Agent", "gearActor", true)}
            {n("polygonAgent", "Polygon Agent", "polygonActor", true)}
          </div>
          <Arrow label="onDone (any)" />
          {n("agentResult", "Agent Result", "createWaitingPendingActor")}
          <Arrow />
          {n("sortGroup", "Sort Group", "sortGroupActor")}
          <Arrow />
          {n("advanceBatch", "Advance Batch", "updatePendWaitingActor")}
          <LoopBadge label="→ orchestrator" />
        </div>
      </div>

      {/* LANE 3 — director + delegator loop (the meaty part) */}
      <div
        style={{ ...LANE_STYLE, borderColor: "#93c5fd", background: "#f8fafc" }}
      >
        <div style={{ ...LANE_TITLE, color: "#3b82f6" }}>
          Director → Delegator loop (per action pair, repeats until job done)
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          {n("director.atomize", "Atomize", "atomizerActor")}
          <Arrow label="isAtomizerActions" />
          {n(
            "director.createActionsTable",
            "Create Actions Table",
            "createActionsTableActor",
          )}
          <Arrow />
          {n(
            "delegator.cameraPosition",
            "Camera Position",
            "cameraPositionActor",
          )}
          <Arrow />
          {n("delegator.delegate", "Delegate", "delegatorActor")}
        </div>

        {/* fork */}
        <div style={{ display: "flex", gap: 4, marginTop: 8, marginLeft: 40 }}>
          <Arrow vertical label="isRobotAction" />
        </div>
        <div style={{ display: "flex", gap: 40, marginTop: 4 }}>
          <div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>
              Robot branch
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {n(
                "delegator.robotBranch.robotActor",
                "Robot Actor",
                "robotActor",
                true,
              )}
              <Arrow />
              {n(
                "delegator.robotBranch.rosActor",
                "ROS Actor",
                "rosActor (robot)",
                true,
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>
              Human branch — isHumanAction
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {n(
                "delegator.humanBranch.humanActor",
                "Human Actor",
                "humanActor",
                true,
              )}
              <Arrow />
              {n(
                "delegator.humanBranch.humanInterpreterActor",
                "Human Interpreter",
                "humanInterpreterActor",
                true,
              )}
              <Arrow />
              {n(
                "delegator.humanBranch.rosActor",
                "ROS Actor",
                "rosActor (human)",
                true,
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 12,
            marginLeft: 40,
          }}
        >
          <Arrow label="both branches converge" />
          {n("delegator.validator", "Validator", "validatorActor")}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            marginLeft: 40,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 10, color: "#9ca3af" }}>valid →</span>
          {n(
            "delegator.updateActionsTable",
            "Update Actions Table",
            "updateActionsTableActor",
          )}
          <LoopBadge label="→ Atomize (next pair)" />
          <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 12 }}>
            invalid →
          </span>
          <LoopBadge label="retry → Delegate" />
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          {n("delegator.validatorError", "Validator Error", undefined, true)}
          {n("delegator.executionError", "Execution Error", undefined, true)}
          <div style={{ display: "flex", alignItems: "center" }}>
            <LoopBadge label="always → orchestrator" />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <LoopBadge label="allTasksDone → orchestrator (isDone/idle or next batch)" />
        </div>
      </div>
    </div>
  );
}
