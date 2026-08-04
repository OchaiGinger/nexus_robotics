// src/actors/cameraPositionActor.ts
import { fromPromise } from "xstate";

type CameraPositionActorInput = {
  job: { id: string };
  actionsResult: { label: "done"; jobId: string; pair: any };
};

type CameraPositionActorOutput = {
  label: "done";
  jobId: string;
  actionsResult: { label: "done"; jobId: string; pair: any };
};

export const cameraPositionActor = fromPromise<
  CameraPositionActorOutput,
  CameraPositionActorInput
>(async ({ input }) => {
  if (!input.actionsResult?.pair) {
    throw new Error("cameraPositionActor requires actionsResult.pair");
  }

  const res = await fetch("/api/actors/camera-position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error ?? "cameraPositionActor request failed");
  return data as CameraPositionActorOutput;
});
