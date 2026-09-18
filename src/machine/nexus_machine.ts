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
import { nextActionActor } from "./actors/nextActionActor";

// delegator subagents

import { delegatorActor } from "./actors/delegatorActor";
import { robotActor } from "./actors/robotActor";
import { humanActor } from "./actors/humanActor";
import { humanInterpreterActor } from "./actors/humanInterpreterActor";
import { rosActor } from "./actors/rosActor";
import { validatorActor } from "./actors/validatorActor";
import { updateActionsTableActor } from "./actors/updateActionsTableActor";
import type { UpdateActionsTableActorInput } from "./actors/updateActionsTableActor";
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
  jobId?: string;
  sortGroupId?: string;
  sortGroups?: Array<{
    id: string;
    order: number;
    difficulty: number;
    taskIds: string[];
    taskTypes: string[];
  }>;
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

  // Full flattened atom breakdown for the current batch, produced once
  // by atomizerActor and bulk-persisted by createActionsTableActor.
  // Not touched again after that — nextActionActor reads from the
  // Action table directly, not from this array.
  actions?: Array<{
    taskId: string;
    atomIndex: number;
    atomType: string;
    pair: unknown;
  }>;

  // The single Action row currently being worked, set by nextActionActor
  // and read through the whole delegator branch.
  actionId?: string;

  // one action pair at a time — the pair currently being worked. Also
  // carries whatever cameraPositionActor and delegatorActor have
  // enriched it with (toolLocation, role, etc.) — there's no separate
  // `cameraPosition` context field anymore, since that data now travels
  // on the pair itself.
  actionsResult?: {
    label: "done";
    jobId: string;
    pair: ActionPair;
  };
  dispatchMode?: "single" | "both";
  dispatchRole?: "robot" | "human";
  // delegator context
  robotPlan?: unknown;
  humanInstructions?: unknown;
  humanResult?: unknown;
  robotRosResult?: unknown;
  humanRosResult?: unknown;
  // per-side validation outcomes for the "both" (simultaneous
  // robot+human) branch — each region sets its own half independently
  // as soon as its side passes; the branch only completes once both are set.
  robotValidation?: { robotCorrect: boolean };
  humanValidation?: { humanCorrect: boolean };
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
    nextActionActor,


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

    // nextAction routing — replaces the old atomizer loop guards
    // (isAtomizerActions / isAtomizerTaskDoneMoreTasks /
    // isAtomizerAllTasksDone), which are gone now that atomization
    // happens once per batch up front instead of one atom at a time.
    isActionFound: ({ event }) => (event as any).output?.route === "action",
    isAllActionsDone: ({ event }) =>
      (event as any).output?.route === "allActionsDone",

    // delegator routing — decided by delegatorActor based on the atom's
    // atomType (see delegatorActor's ATOM_ROLE table). A pair can now
    // carry either one atom (single actor) or two simultaneous atoms
    // (robot + human working at once) — delegatorActor reports which
    // case this is via .mode.
    isRobotAction: ({ event }) =>
      (event as any).output?.mode === "single" &&
      (event as any).output?.role === "robot",
    isHumanAction: ({ event }) =>
      (event as any).output?.mode === "single" &&
      (event as any).output?.role === "human",
    isBothActions: ({ event }) => (event as any).output?.mode === "both",

    // per-branch validator outcomes for the "both" region — each side is
    // checked independently against its own ROS result.
    isRobotCorrect: ({ event }) => (event as any).output?.robotCorrect === true,
    isRobotIncorrect: ({ event }) => (event as any).output?.robotCorrect !== true,
    isHumanCorrect: ({ event }) => (event as any).output?.humanCorrect === true,
    isHumanIncorrect: ({ event }) => (event as any).output?.humanCorrect !== true,

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
    jobId: undefined,
    sortGroupId: undefined,
    sortGroups: undefined,
    agentResult: undefined,
    toolResult: undefined,
    actions: undefined,
    actionId: undefined,
    actionsResult: undefined,
    dispatchMode: undefined,
    dispatchRole: undefined,

    robotPlan: undefined,
    humanInstructions: undefined,
    humanResult: undefined,
    robotRosResult: undefined,
    humanRosResult: undefined,
    robotValidation: undefined,
    humanValidation: undefined,
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
            jobId: ({ event }) => (event as any).job?.id,
            sortGroups: undefined,
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
        // XState invoke failures are carried in `event.error`, not
        // `event.output`. Keeping it lets FlowGraph show the real API/DB
        // failure instead of an empty error panel.
        lastError: ({ event }) => (event as any).error ?? (event as any).output,
      }),
      always: {
        target: "#nexus.idle",
        reenter: true,
        actions: assign({
          origin: undefined,
          job: undefined,
          jobId: undefined,
          sortGroupId: undefined,
          sortGroups: undefined,
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

    // director: atomize the whole batch's pending tasks into a flat list
    // of atom-pairs in one shot, then bulk-persist them as "waiting"
    // Action rows. The walk-one-at-a-time loop lives outside this state,
    // in nextAction / updateActionPending / delegator / validator.
    director: {
      initial: "atomize",
      states: {
        atomize: {
          invoke: {
            src: "atomizerActor",
            id: "AtomizerActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
            }),
            onDone: {
              target: "createActionsTable",
              actions: assign({
                actions: ({ event }) => (event.output as any).actions,
              }),
              reenter: true,
            },
            onError: { target: "#nexus", reenter: true },
          },
        },

        createActionsTable: {
          invoke: {
            src: "createActionsTableActor",
            id: "CreateActionsTableActor",
            input: ({ context }: { context: NexusContext }) => ({
              jobId: context.jobId!,
              actions: context.actions!,
            }),
            onDone: { target: "#nexus.nextAction", reenter: true },
            onError: { target: "#nexus", reenter: true },
          },
        },
      },
    },

    // nextAction: finds the next "waiting" Action row for this job (in
    // task-order, atom-order). If found, hands its pair into context and
    // moves to mark it "pending" before the delegator works it. If none
    // are left, the whole batch's actions are done — back to the
    // orchestrator to advance to the next batch.
    nextAction: {
      invoke: {
        src: "nextActionActor",
        id: "NextActionActor",
        input: ({ context }: { context: NexusContext }) => ({
          jobId: context.jobId!,
        }),
        onDone: [
          {
            target: "updateActionPending",
            guard: "isActionFound",
            actions: assign({
              actionId: ({ event }) => (event.output as any).actionId,
              actionsResult: ({ context, event }) => ({
                label: "done" as const,
                jobId: context.jobId!,
                pair: (event.output as any).pair,
              }),
              // clear any leftover per-side validation state from a
              // previous "both" action before starting the next one
              robotValidation: undefined,
              humanValidation: undefined,
            }),
            reenter: true,
          },
          {
            target: "orchestrator",
            guard: "isAllActionsDone",
            actions: assign({
              origin: "nextBatch",
              actionId: undefined,
              actionsResult: undefined,
              actions: undefined,
            }),
            reenter: true,
          },
        ],
        onError: { target: "#nexus", reenter: true },
      },
    },

    // updateActionPending: flips the Action row nextAction just found
    // from "waiting" to "pending" before the delegator starts working it.
    updateActionPending: {
      invoke: {
        src: "updateActionsTableActor",
        id: "UpdateActionPending",
        input: ({ context }: { context: NexusContext }) => ({
          actionId: context.actionId!,
          status: "pending",
        }),
        onDone: { target: "#nexus.delegator.delegate", reenter: true },
        onError: { target: "#nexus", reenter: true },
      },
    },
    // delegator: cameraPosition (enrich the pair with tool location via
    // YOLO + ToF over ROS) -> delegate (decide robot-only / human-only /
    // both-simultaneous for this action) -> whichever branch applies ->
    // validator writes the completed status through the API and loops
    // back to nextAction for whatever's next.
    delegator: {
      initial: "delegate",
      states: {
        delegate: {
          invoke: {
            src: "delegatorActor",
            id: "DelegatorActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              actionsResult: context.actionsResult!,
            }),
            onDone: [
              {
                target: "robotBranch",
                guard: "isRobotAction",
                actions: assign({ dispatchMode: "single", dispatchRole: "robot" }),
                reenter: true,
              },
              {
                target: "humanBranch",
                guard: "isHumanAction",
                actions: assign({ dispatchMode: "single", dispatchRole: "human" }),
                reenter: true,
              },
              {
                target: "bothBranch",
                guard: "isBothActions",
                actions: assign({ dispatchMode: "both", dispatchRole: undefined }),
                reenter: true,
              },
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
                  actions: assign({ robotPlan: ({ event }) => event.output.robotPlan }),
                  reenter: true,
                },
                onError: { target: "#nexus.delegator.executionError", reenter: true },
              },
            },
            rosActor: {
              invoke: {
                src: "rosActor",
                id: "RobotRosActor",
                input: ({ context }: { context: NexusContext }) => ({
                  job: context.job!,
                  actionId: context.actionId!,
                  source: "robot",
                  payload: context.robotPlan,
                }),
                onDone: { target: "#nexus.delegator.validator", reenter: true },
                onError: { target: "#nexus.delegator.executionError", reenter: true },
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
                  actionId: context.actionId!,
                  source: "human",
                  payload: context.humanResult,
                }),
                onDone: {
                  target: "#nexus.delegator.validator",
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

        // bothBranch: robot and human work simultaneously — two
        // independent regions, each with its own execute -> ROS ->
        // validate loop. Whichever side returns first is validated
        // immediately and, if it passes, sits in its own "done" final
        // state waiting on the other; a failing side retries on its
        // own without blocking the side that already passed. The
        // parallel state's onDone only fires once BOTH regions reach
        // "done", which is exactly "validating the one that returns
        // first, staying pending on the other, until both pass."
        //
        // NOTE: these regions previously had placeholder comments
        // ("/* same as robotBranch.robotActor above */") instead of
        // real invoke configs. An empty state node has nothing to
        // invoke and nothing to transition on, so the machine parked
        // silently inside bothBranch forever and validator was never
        // reached. Filled in below with real invokes (distinct ids so
        // they don't collide with the single-branch versions).
        bothBranch: {
          type: "parallel",
          states: {
            robotRegion: {
              initial: "robotActor",
              states: {
                robotActor: {
                  invoke: {
                    src: "robotActor",
                    id: "RobotActorBoth",
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
                    id: "RobotRosActorBoth",
                    input: ({ context }: { context: NexusContext }) => ({
                      job: context.job!,
                      actionId: context.actionId!,
                      source: "robot",
                      payload: context.robotPlan,
                    }),
                    onDone: { target: "done", reenter: true },
                    onError: {
                      target: "#nexus.delegator.executionError",
                      reenter: true,
                    },
                  },
                },
                done: { type: "final" },
              },
            },
            humanRegion: {
              initial: "humanActor",
              states: {
                humanActor: {
                  invoke: {
                    src: "humanActor",
                    id: "HumanActorBoth",
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
                    id: "HumanInterpreterActorBoth",
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
                    id: "HumanRosActorBoth",
                    input: ({ context }: { context: NexusContext }) => ({
                      job: context.job!,
                      actionId: context.actionId!,
                      source: "human",
                      payload: context.humanResult,
                    }),
                    onDone: { target: "done", reenter: true },
                    onError: {
                      target: "#nexus.delegator.executionError",
                      reenter: true,
                    },
                  },
                },
                done: { type: "final" },
              },
            },
          },
          onDone: { target: "#nexus.delegator.validator", reenter: true },
        },

        validator: {
          invoke: {
            src: "validatorActor",
            id: "ValidatorActor",
            input: ({ context }: { context: NexusContext }) => ({
              job: context.job!,
              actionId: context.actionId!,
              mode: context.dispatchMode!,
              role: context.dispatchRole,
            }),
            onDone: [
              {
                target: "#nexus.nextAction",
                guard: "isValidatorValid",
                actions: assign({ validationResult: ({ event }) => event.output }),
                reenter: true,
              },
              {
                target: "delegate",
                guard: "isValidatorInvalid",
                actions: assign({ validationResult: ({ event }) => event.output }),
                reenter: true,
              },
            ],
            onError: { target: "validatorError", reenter: true },
          },
        },

        validatorError: {
          entry: [
            ({ event }: any) => console.error("[validatorError]", event.error),
            assign({ lastError: ({ event }) => (event as any).error }),
          ],
          always: { target: "#nexus.orchestrator", reenter: true },
        },

        executionError: {
          entry: [
            ({ event }: any) => console.error("[executionError]", event.error),
            assign({ lastError: ({ event }) => (event as any).error }),
          ],
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
        onDone: { target: "prepareToolResult", reenter: true },
        onError: { target: "#nexus", reenter: true },
      },
    },

    prepareToolResult: {
      always: {
        target: "toolAppend",
        actions: assign({
          toolResult: ({ context }) => {
            const groups = context.sortGroups ?? [];
            const allTaskIds = groups.flatMap((g) => g.taskIds);
            const allTaskTypes = groups.flatMap((g) => g.taskTypes);
            const tools = allTaskIds.map((id, idx) => ({
              id,
              type: allTaskTypes[idx] ?? "unknown",
            }));
            return {
              label: "done" as const,
              jobId: context.jobId!,
              tools,
            };
          },
        }),
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
            sortGroups: ({ event }) => event.output.groups,
          }),
          reenter: true,
        },
        onError: { target: "#nexus", reenter: true },
      },
    },
  },
});

export { machine };