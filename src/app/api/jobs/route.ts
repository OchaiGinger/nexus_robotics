import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { JobType, schemaByType } from "@/lib/schemas/job-payloads";

type TaskRecord = {
  id: string;
  jobId: string;
  type: string;
  payload: unknown;
  status: string;
  createdAt: Date;
};

type ActionRecord = {
  id: string;
  jobId: string;
  status: string;
  createdAt: Date;
};

type JobSummary = {
  id: string;
  type: JobType;
  status: "queued" | "running" | "completed" | "failed";
  canResume: boolean;
  progress: number;
  taskCount: number;
  completedTaskCount: number;
  actionCount: number;
  completedActionCount: number;
  createdAt: Date;
  lastActivity: Date;
  payload: Record<string, unknown>;
};

function isJobType(value: unknown): value is JobType {
  return typeof value === "string" && value in schemaByType;
}

function publicPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const source = payload as Record<string, unknown>;
  const { imageDataUrl, imageMimeType, ...rest } = source;
  return {
    ...rest,
    hasImage: typeof imageDataUrl === "string" && imageDataUrl.length > 0,
    imageMimeType: typeof imageMimeType === "string" ? imageMimeType : null,
  };
}

function jobStatus(
  tasks: TaskRecord[],
  actions: ActionRecord[],
): Extract<JobSummary["status"], "queued" | "running" | "completed" | "failed"> {
  if (tasks.some((task) => task.status === "error" || task.status === "failed")) {
    return "failed";
  }

  if (actions.length > 0 && actions.every((action) => action.status === "completed")) {
    return "completed";
  }

  if (
    actions.length > 0 ||
    tasks.some((task) => task.status === "pending" || task.status === "waiting")
  ) {
    return "running";
  }

  return "queued";
}

function latestDate(values: Date[]): Date {
  return values.reduce(
    (latest, current) => (current > latest ? current : latest),
    values[0],
  );
}

export async function GET() {
  try {
    const [taskRows, actionRows] = await Promise.all([
      prisma.task.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          jobId: true,
          type: true,
          payload: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.action.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          jobId: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    const tasksByJob = new Map<string, TaskRecord[]>();
    for (const task of taskRows) {
      const tasks = tasksByJob.get(task.jobId) ?? [];
      tasks.push(task);
      tasksByJob.set(task.jobId, tasks);
    }

    const actionsByJob = new Map<string, ActionRecord[]>();
    for (const action of actionRows) {
      const actions = actionsByJob.get(action.jobId) ?? [];
      actions.push(action);
      actionsByJob.set(action.jobId, actions);
    }

    const jobs: JobSummary[] = [...tasksByJob.entries()]
      .map(([jobId, tasks]) => {
        const firstTask = tasks[tasks.length - 1];
        const actions = actionsByJob.get(jobId) ?? [];
        const completedTasks = tasks.filter((task) => task.status === "completed").length;
        const completedActions = actions.filter(
          (action) => action.status === "completed",
        ).length;
        const status = jobStatus(tasks, actions);
        const totalProgressItems = actions.length > 0 ? actions.length : tasks.length;
        const completedProgressItems = actions.length > 0 ? completedActions : completedTasks;
        const type = firstTask?.type;

        if (!firstTask || !isJobType(type)) {
          return null;
        }

        return {
          id: jobId,
          type,
          status,
          canResume: status !== "completed" && status !== "failed",
          progress: totalProgressItems === 0 ? 0 : completedProgressItems / totalProgressItems,
          taskCount: tasks.length,
          completedTaskCount: completedTasks,
          actionCount: actions.length,
          completedActionCount: completedActions,
          createdAt: firstTask.createdAt,
          lastActivity: latestDate([
            ...tasks.map((task) => task.createdAt),
            ...actions.map((action) => action.createdAt),
          ]),
          payload: publicPayload(firstTask.payload),
        };
      })
      .filter((job): job is JobSummary => job !== null)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const jobId = body.jobId;
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json(
      { error: "jobId is required" },
      { status: 400 },
    );
  }

  try {
    const task = await prisma.task.findFirst({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    });

    if (!task) {
      return NextResponse.json(
        { error: `No persisted job found for ${jobId}` },
        { status: 404 },
      );
    }

    if (!isJobType(task.type)) {
      return NextResponse.json(
        { error: `Unsupported persisted job type: ${task.type}` },
        { status: 409 },
      );
    }

    const result = schemaByType[task.type].safeParse(task.payload);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Persisted job payload is no longer valid",
          issues: result.error.issues,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      job: {
        id: jobId,
        type: task.type,
        payload: result.data,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
