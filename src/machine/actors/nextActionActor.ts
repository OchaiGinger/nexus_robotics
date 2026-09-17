// src/actors/nextActionActor.ts
import { fromPromise } from "xstate";

type NextActionInput = { jobId: string };

type NextActionOutput =
  | {
      label: "done";
      jobId: string;
      route: "action";
      actionId: string;
      pair: unknown;
    }
  | {
      label: "done";
      jobId: string;
      route: "allActionsDone";
    };

export const nextActionActor = fromPromise<NextActionOutput, NextActionInput>(
  async ({ input }) => {
    if (!input.jobId) {
      throw new Error("nextActionActor requires a jobId");
    }

    const res = await fetch("/api/actors/next-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: input.jobId }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "nextActionActor request failed");
    }

    return data as NextActionOutput;
  },
);