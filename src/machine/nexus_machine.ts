import { assign, setup } from "xstate";

// All Actors
import { ochestratorActor } from "./actors/orchestratorActor";
import { queueActor } from "./actors/queueActor";
import { updatePendWaitingActor } from "./actors/updatePendingWaitingActor";
import { validateJobActor } from "./actors/validateJobActor";

//cue subagents
import { projectionActor } from "./actors/projectionActor";
import { angleActor } from "./actors/angleActor";
import { gearActor } from "./actors/gearActor";
import { polygonActor } from "./actors/polygonActor";
import { createWaitingPendingActor } from "./actors/createWaitingPendingActor";
import { sortGroupActor } from "./actors/sortGroupActor";
import { toolSmithActor } from "./actors/toolSmithActor";
import { toolAppendActor } from "./actors/toolAppendActor";
import { atomizerActor } from "./actors/atomizerActor";
import { createActionsTableActor } from "./actors/createActionsTableActor";

// delegator subagents
import { cameraPositionActor } from "./actors/cameraPositionActor";
import { delegatorActor } from "./actors/delegatorActor";
import { robotActor } from "./actors/robotActor";
import { humanActor } from "./actors/humanActor";
import { humanInterpreterActor } from "./actors/humanInterpreterActor";
import { rosActor } from "./actors/rosActor";
import { validatorActor } from "./actors/validatorActor";
import { updateActionsTableActor } from "./actors/updateActionsTableActor";
import { ActionPair } from "./actors/types";

// Named context type — explicitly annotated on every `input: ({ context }) => ...`
// callback below. This is a workaround: normally XState infers `context`'s type
// automatically from `types.context` in `setup()`, but that inference chain
// breaks (falls back to `any`) if ANY actor registered in `actors: {...}` isn't
// wrapped as `fromPromise<Output, Input>` with explicit generics. Once your four
// original actors (ochestratorActor, queueActor, updatePendWaitingActor,
// validateJobActor) all have explicit fromPromise<Output, Input> typing, these
// manual annotations become redundant and can be removed.
type NexusContext = {
  origin?: "newJob" | "nextBatch";
  job?: {
    id: string;
    type: "projectionAgent" | "angleAgent" | "gearAgent" | "polygonAgent";
    payload: unknown;
  };
  sortGroupId?: string;
  agentResult?: {
    label: "done";
    jobId: string;
    agent: "projectionActor" | "angleActor" | "gearActor" | "polygonActor";
    result: unknown;
  };
  toolResult?: {
    label: "done";
    jobId: string;
    tools: unknown;
  };
  // one action pair at a time — the atomizer hands back exactly one
  // pair per call (same as the director handing back exactly one task
  // at a time from the job's payload), so there's no array/cursor to
  // track here. The pair also carries whatever cameraPositionActor and
  // delegatorActor have enriched it with (toolLocation, role, etc.) —
  // there's no separate `cameraPosition` context field anymore, since
  // that data now travels on the pair itself.
  actionsResult?: {
    label: "done";
    jobId: string;
    pair: ActionPair;
  };
  // delegator context
  robotPlan?: unknown;
  humanInstructions?: unknown;
  humanResult?: unknown;
  robotRosResult?: unknown;
  humanRosResult?: unknown;
  validationResult?: {
    label: "done";
    jobId: string;
    robotCorrect: boolean;
    humanCorrect: boolean;
    valid: boolean;
  };

  // set by validatorError/executionError entry actions, and available for
  // the orchestrator (or your own logging/telemetry) to inspect
  lastError?: unknown;
};

const machine = setup({
  types: {} as {
    context: NexusContext;
  },

  actors: {
    ochestratorActor,
    queueActor,
    updatePendWaitingActor,

    validateJobActor,
    projectionActor,
    angleActor,
    gearActor,
    polygonActor,

    createWaitingPendingActor,
    sortGroupActor,
    toolSmithActor,
    toolAppendActor,
    atomizerActor,
    createActionsTableActor,

    cameraPositionActor,
    delegatorActor,
    robotActor,
    humanActor,
    humanInterpreterActor,
    rosActor,
    validatorActor,
    updateActionsTableActor,
  },
  guards: {
    isNewJob: ({ event }) => event.output.route === "newJob",
    isNextBatch: ({ event }) => event.output.route === "nextBatch",
    isTask: ({ event }) => event.output.route === "task",
    isTools: ({ event }) => event.output.route === "tools",
    isDone: ({ event }) => event.output.route === "done",

    // validateJob routing
    isProjectionAgent: ({ event }) =>
      (event as any).output?.label === "projectionAgent",
    isAngleAgent: ({ event }) => (event as any).output?.label === "angleAgent",
    isGearAgent: ({ event }) => (event as any).output?.label === "gearAgent",
    isPolygonAgent: ({ event }) =>
      (event as any).output?.label === "polygonAgent",
    isNextBatchFromQueue: ({ event }) =>
      (event as any).output?.label === "nextBatch",
    // cue's own "did queueActor say newJob" check — separate from
    // orchestrator's isNewJob, which checks a different field
    // (.route) on a differently-shaped output. queueActor returns
    // .label, same as isNextBatchFromQueue below it.
    isNewJobFromQueue: ({ event }) => (event as any).output?.label === "newJob",

    // atomizer routing (action/task/job loop)
    isAtomizerActions: ({ event }) =>
      (event as any).output?.route === "actions",
    isAtomizerTaskDoneMoreTasks: ({ event }) =>
      (event as any).output?.route === "taskDone" &&
      (event as any).output?.hasMoreTasks === true,
    isAtomizerAllTasksDone: ({ event }) =>
      (event as any).output?.route === "taskDone" &&
      (event as any).output?.hasMoreTasks !== true,

    // delegator routing — decided by delegatorActor based on the atom's
    // atomType (see delegatorActor's ATOM_ROLE table)
    isRobotAction: ({ event }) => (event as any).output?.role === "robot",
    isHumanAction: ({ event }) => (event as any).output?.role === "human",

    // only advance to the next pair once the validator approves the
    // current one — otherwise retry it
    isValidatorValid: ({ event }) => (event as any).output?.valid === true,
    isValidatorInvalid: ({ event }) => (event as any).output?.valid !== true,
    isInvalidJob: ({ event }) => (event as any).output?.label === "invalid",
  },
}).createMachine({
  id: "nexus",
  initial: "idle",
  context: {
    origin: undefined,
    job: undefined,
    sortGroupId: undefined,
    agentResult: undefined,
    toolResult: undefined,
    actionsResult: undefined,

    robotPlan: undefined,
    humanInstructions: undefined,
    humanResult: undefined,
    robotRosResult: undefined,
    humanRosResult: undefined,
    validationResult: undefined,

    lastError: undefined,
  },
  states: {
    idle: {
      on: {
        new_job: {
          target: "orchestrator",
          actions: assign({
            origin: "newJob",
            job: ({ event }) => (event as any).job,
          }),
          reenter: true,
        },
      },
    },

    orchestrator: {
      invoke: {
        src: "ochestratorActor",
        id: "Ochestrator",

        input: ({ context }: { context: NexusContext }) => ({
          origin: context.origin,
          job: context.job,
          sortGroupId: context.sortGroupId,
          toolResult: context.toolResult,
          actionsResult: context.actionsResult,
          validationResult: context.validationResult,
        }),

        onDone: [
          { target: "cue", guard: "isNextBatch" },
          { target: "tool", reenter: true, guard: "isTask" },
          { target: "idle", reenter: true, guard: "isDone" },
          { target: "director", guard: "isTools", reenter: true },
          { target: "cue", guard: "isNewJob" },
        ],

        onError: { target: "#nexus", reenter: true },
      },
    },

    cue: {
      invoke: {
        src: "queueActor",
        id: "QueueActor",
        input: ({ context }: { context: NexusContext }) => ({
          origin: context.origin!,
          job: context.job,
          sortGroupId: context.sortGroupId,
        }),
        onDone: [
          {
            target: "validateJobActor",
            guard: "isNewJobFromQueue",
            actions: assign({ origin: undefined }),
          },
          {
            target: "advanceBatch",
            guard: "isNextBatchFromQueue",
            actions: assign({
              origin: undefined,
              job: undefined,
              toolResult: undefined,
              sortGroupId: ({ event }) =>
                event.output.label === "nextBatch"
                  ? event.output.sortGroupId
                  : undefined,
            }),
            reenter: true,
          },
          { target: "cueError", reenter: true },
        ],
        onError: { target: "cueError", reenter: true },
      },
    },
    cueError: {
      entry: assign({
        lastError: ({ event }) => (event as any).output,
      }),
      always: {
        target: "#nexus.idle",
        reenter: true,
        actions: assign({
          origin: undefined,
          job: undefined,
          sortGroupId: undefined,
          toolResult: undefined,
        }),
      },
    },

    tool: {
      invoke: {
        src: "toolSmithActor",
        id: "ToolSmithActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: context.job!,
        }),
        onDone: {
          target: "toolAppend",
          actions: assign({ toolResult: ({ event }) => event.output }),
          reenter: true,
        },
        onError: { target: "#nexus", reenter: true },
      },
    },
    validateJobActor: {
      invoke: {
        src: "validateJobActor",
        id: "ValidateJobActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: context.job!,
        }),
        onDone: [
          { target: "projectionAgent", guard: "isProjectionAgent" },
          { target: "angleAgent", guard: "isAngleAgent", reenter: true },
          { target: "gearAgent", guard: "isGearAgent", reenter: true },
          { target: "polygonAgent", guard: "isPolygonAgent", reenter: true },
          {
            target: "#nexus",
            guard: "isInvalidJob",
            actions: assign({
              lastError: ({ event }) =>
                new Error(
                  `Job validation failed: ${(event as any).output.reason}`,
                ),
            }),
            reenter: true,
          },
          {
            target: "#nexus",
            actions: assign({
              lastError: ({ event }) =>
                new Error(
                  `validateJobActor returned unrecognized label: ${JSON.stringify(
                    (event as any).output,
                  )}`,
                ),
            }),
            reenter: true,
          },
        ],
        onError: "#nexus",
      },
    },

    toolAppend: {
      invoke: {
        src: "toolAppendActor",
        id: "ToolAppendActor",
        input: ({ context }: { context: NexusContext }) => ({
          toolResult: context.toolResult!,
        }),
        onDone: "orchestrator",
        onError: { target: "tool", reenter: true },
      },
    },

    // director: atomize a task into action pairs, then execute each pair
    // through the delegator (camera -> delegate -> robot OR human ->
    // validator), looping back here for the next pair/task until the
    // whole job is done.
    director: {
      initial: "atomize",
      states: {
        atomize: {
          invoke: {
            src: "atomizerActor",
            id: "AtomizerActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              toolResult: context.toolResult,
              actionsResult: context.actionsResult,
              validationResult: context.validationResult,
            }),
            onDone: [
              {
                target: "createActionsTable",
                guard: "isAtomizerActions",
                actions: assign({
                  actionsResult: ({ event }) => ({
                    label: "done" as const,
                    jobId: (event.output as any).jobId,
                    pair: (event.output as any).pair,
                  }),
                }),
                reenter: true,
              },
              {
                target: "atomize",
                guard: "isAtomizerTaskDoneMoreTasks",
                actions: assign({
                  actionsResult: undefined,
                  validationResult: undefined,
                }),
                reenter: true,
              },
              {
                target: "#nexus.orchestrator",
                guard: "isAtomizerAllTasksDone",
                actions: assign({
                  origin: "nextBatch",
                  actionsResult: undefined,
                  validationResult: undefined,
                }),
                reenter: true,
              },
            ],
            onError: { target: "#nexus", reenter: true },
          },
        },

        createActionsTable: {
          invoke: {
            src: "createActionsTableActor",
            id: "CreateActionsTableActor",
            input: ({ context }: { context: NexusContext }) => ({
              actionsResult: context.actionsResult!,
            }),
            onDone: {
              target: "#nexus.delegator",
              actions: assign({
                actionsResult: ({ event }) => event.output as any,
              }),
              reenter: true,
            },
            onError: { target: "#nexus", reenter: true },
          },
        },
      },
    },

    // delegator: cameraPosition (enrich the pair with tool location via
    // YOLO + ToF over ROS) -> delegate (decide robot vs human for this
    // atom) -> whichever single branch applies -> validator once that
    // branch finishes -> tally the action as done and loop back to the
    // atomizer for what's next.
    delegator: {
      initial: "cameraPosition",
      states: {
        cameraPosition: {
          invoke: {
            src: "cameraPositionActor",
            id: "CameraPositionActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              actionsResult: context.actionsResult!,
            }),
            onDone: {
              target: "delegate",
              actions: assign({
                actionsResult: ({ event }) => event.output.actionsResult,
              }),
              reenter: true,
            },
            onError: { target: "executionError", reenter: true },
          },
        },

        delegate: {
          invoke: {
            src: "delegatorActor",
            id: "DelegatorActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              actionsResult: context.actionsResult!,
            }),
            onDone: [
              { target: "robotBranch", guard: "isRobotAction", reenter: true },
              { target: "humanBranch", guard: "isHumanAction", reenter: true },
            ],
            onError: { target: "executionError", reenter: true },
          },
        },

        robotBranch: {
          initial: "robotActor",
          states: {
            robotActor: {
              invoke: {
                src: "robotActor",
                id: "RobotActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  actionsResult: context.actionsResult,
                }),
                onDone: {
                  target: "rosActor",
                  actions: assign({
                    robotPlan: ({ event }) => event.output.robotPlan,
                  }),
                  reenter: true,
                },
                onError: {
                  target: "#nexus.delegator.executionError",
                  reenter: true,
                },
              },
            },

            rosActor: {
              invoke: {
                src: "rosActor",
                id: "RobotRosActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  source: "robot",
                  payload: context.robotPlan,
                }),
                onDone: {
                  target: "#nexus.delegator.validator",
                  actions: assign({
                    robotRosResult: ({ event }) => event.output.rosResult,
                  }),
                  reenter: true,
                },
                onError: {
                  target: "#nexus.delegator.executionError",
                  reenter: true,
                },
              },
            },
          },
        },

        humanBranch: {
          initial: "humanActor",
          states: {
            humanActor: {
              invoke: {
                src: "humanActor",
                id: "HumanActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  actionsResult: context.actionsResult,
                }),
                onDone: {
                  target: "humanInterpreterActor",
                  actions: assign({
                    humanInstructions: ({ event }) =>
                      event.output.humanInstructions,
                  }),
                  reenter: true,
                },
                onError: {
                  target: "#nexus.delegator.executionError",
                  reenter: true,
                },
              },
            },

            humanInterpreterActor: {
              invoke: {
                src: "humanInterpreterActor",
                id: "HumanInterpreterActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  humanInstructions: context.humanInstructions,
                }),
                onDone: {
                  target: "rosActor",
                  actions: assign({
                    humanResult: ({ event }) => event.output.humanResult,
                  }),
                  reenter: true,
                },
                onError: {
                  target: "#nexus.delegator.executionError",
                  reenter: true,
                },
              },
            },

            rosActor: {
              invoke: {
                src: "rosActor",
                id: "HumanRosActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  source: "human",
                  payload: context.humanResult,
                }),
                onDone: {
                  target: "#nexus.delegator.validator",
                  actions: assign({
                    humanRosResult: ({ event }) => event.output.rosResult,
                  }),
                  reenter: true,
                },
                onError: {
                  target: "#nexus.delegator.executionError",
                  reenter: true,
                },
              },
            },
          },
        },

        validator: {
          invoke: {
            src: "validatorActor",
            id: "ValidatorActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              robotRosResult: context.robotRosResult,
              humanRosResult: context.humanRosResult,
            }),
            onDone: [
              {
                target: "updateActionsTable",
                guard: "isValidatorValid",
                actions: assign({
                  validationResult: ({ event }) => event.output,
                }),
                reenter: true,
              },
              {
                // rejected — retry. Re-enters "delegate" (no more single
                // "middleman" to re-run); delegatorActor re-decides
                // robot vs human against the unchanged pair. No retry
                // cap yet — add a counter in context if you want one.
                target: "delegate",
                guard: "isValidatorInvalid",
                actions: assign({
                  validationResult: ({ event }) => event.output,
                }),
                reenter: true,
              },
            ],
            onError: { target: "validatorError", reenter: true },
          },
        },

        updateActionsTable: {
          invoke: {
            src: "updateActionsTableActor",
            id: "UpdateActionsTableActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              actionsResult: context.actionsResult!,
              validationResult: context.validationResult!,
            }),
            onDone: {
              target: "#nexus.director.atomize",
              actions: assign({
                actionsResult: ({ event }) => event.output.actionsResult,
              }),
              reenter: true,
            },
            onError: { target: "executionError", reenter: true },
          },
        },

        validatorError: {
          entry: assign({ lastError: ({ event }) => (event as any).error }),
          always: { target: "#nexus.orchestrator", reenter: true },
        },

        executionError: {
          entry: assign({ lastError: ({ event }) => (event as any).error }),
          always: { target: "#nexus.orchestrator", reenter: true },
        },
      },
    },

    advanceBatch: {
      invoke: {
        src: "updatePendWaitingActor",
        id: "UpdatePendWaitingActor",
        input: ({ context }: { context: NexusContext }) => ({
          sortGroupId: context.sortGroupId!,
        }),
        onDone: "orchestrator",
        onError: { target: "#nexus", reenter: true },
      },
    },

    projectionAgent: {
      invoke: {
        src: "projectionActor",
        id: "ProjectionActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: context.job!,
        }),
        onDone: {
          target: "agentResult",
          actions: assign({ agentResult: ({ event }) => event.output }),
        },
        onError: { target: "#nexus", reenter: true },
      },
    },

    angleAgent: {
      invoke: {
        src: "angleActor",
        id: "AngleActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: {
            id: context.job!.id,
            payload: context.job!.payload as {
              label: string;
              angleDegrees: number;
            },
          },
        }),
        onDone: {
          target: "agentResult",
          actions: assign({ agentResult: ({ event }) => event.output }),
        },
        onError: { target: "#nexus", reenter: true },
      },
    },

    gearAgent: {
      invoke: {
        src: "gearActor",
        id: "GearActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: context.job!,
        }),
        onDone: {
          target: "agentResult",
          actions: assign({ agentResult: ({ event }) => event.output }),
        },
        onError: { target: "#nexus", reenter: true },
      },
    },

    polygonAgent: {
      invoke: {
        src: "polygonActor",
        id: "PolygonActor",
        input: ({ context }: { context: NexusContext }) => ({
          job: context.job!,
        }),
        onDone: {
          target: "agentResult",
          actions: assign({ agentResult: ({ event }) => event.output }),
        },
        onError: { target: "#nexus", reenter: true },
      },
    },

    agentResult: {
      invoke: {
        src: "createWaitingPendingActor",
        id: "createWaitingPendingActor",
        input: ({ context }: { context: NexusContext }) => ({
          agentResult: context.agentResult!,
        }),
        onDone: { target: "sortGroup", reenter: true },
        onError: { target: "#nexus", reenter: true },
      },
    },

    sortGroup: {
      invoke: {
        src: "sortGroupActor",
        id: "SortGroupActor",
        input: ({ context }: { context: NexusContext }) => ({
          jobId: context.agentResult!.jobId,
        }),
        onDone: {
          target: "advanceBatch",
          actions: assign({
            sortGroupId: ({ event }) => event.output.sortGroupId,
          }),
          reenter: true,
        },
        onError: { target: "#nexus", reenter: true },
      },
    },
  },
});

export { machine };
