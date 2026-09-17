// src/actors/delegatorActor.ts
import { fromPromise } from "xstate";
import type { ActionPair } from "./types";

type DelegatorActorInput = {
  job: { id: string };
  actionsResult: { label: "done"; jobId: string; pair: ActionPair };
};

type DelegatorActorOutput =
  | {
      label: "done";
      jobId: string;
      mode: "single";
      role: "robot" | "human";
      actionsResult: { label: "done"; jobId: string; pair: ActionPair };
    }
  | {
      label: "done";
      jobId: string;
      mode: "both";
      actionsResult: { label: "done"; jobId: string; pair: ActionPair };
    };

export const delegatorActor = fromPromise<
  DelegatorActorOutput,
  DelegatorActorInput
>(async ({ input }) => {
  const pair = input.actionsResult?.pair;

  if (!Array.isArray(pair) || pair.length === 0) {
    throw new Error(
      "delegatorActor requires actionsResult.pair to be a non-empty array of atoms",
    );
  }

  if (pair.length === 1) {
    return {
      label: "done",
      jobId: input.job.id,
      mode: "single",
      role: pair[0].actor,
      actionsResult: input.actionsResult,
    };
  }

  if (pair.length === 2) {
    const actors = pair.map((a) => a.actor);
    if (!actors.includes("robot") || !actors.includes("human")) {
      throw new Error(
        `delegatorActor: 2-atom pair must contain one robot and one human atom, got: ${actors.join(", ")}`,
      );
    }

    return {
      label: "done",
      jobId: input.job.id,
      mode: "both",
      actionsResult: input.actionsResult,
    };
  }

  throw new Error(
    `delegatorActor: unexpected pair length ${pair.length} — expected 1 (single actor) or 2 (simultaneous robot+human)`,
  );
});