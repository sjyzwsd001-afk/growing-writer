import fg from "fast-glob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_WORKFLOW_DEFINITION,
  resolveStageDefinition,
  type WorkflowDefinition,
} from "./definition.js";

export type WorkflowStage = string;
export type WorkflowStatus = "running" | "completed" | "failed";
export type WorkflowEventType = "entered" | "completed" | "failed" | "action";

export type WorkflowEvent = {
  id: string;
  at: string;
  stage: WorkflowStage;
  type: WorkflowEventType;
  summary: string;
  details?: Record<string, unknown>;
};

export type WorkflowRun = {
  runId: string;
  taskId: string;
  taskPath: string;
  title: string;
  definitionId: string;
  definitionVersion: number;
  status: WorkflowStatus;
  currentStage: WorkflowStage;
  createdAt: string;
  updatedAt: string;
  events: WorkflowEvent[];
};

function safeTimestampId(input: string): string {
  return input.replace(/[^0-9TZ-]/g, "");
}

function workflowRunsDir(vaultRoot: string): string {
  return join(vaultRoot, "workflow-runs");
}

function workflowRunPath(vaultRoot: string, runId: string): string {
  return join(workflowRunsDir(vaultRoot), `${runId}.json`);
}

function isAllowedTransition(definition: WorkflowDefinition, from: WorkflowStage, to: WorkflowStage): boolean {
  if (from === to) {
    return true;
  }

  const stage = resolveStageDefinition(definition, from);
  if (!stage) {
    return false;
  }
  if (stage.next.includes(to)) {
    return true;
  }
  const actionTargets = Object.values(stage.actions ?? {});
  return actionTargets.includes(to);
}

function eventId(runId: string, seq: number): string {
  return `${runId}-event-${String(seq).padStart(4, "0")}`;
}

async function saveWorkflowRun(vaultRoot: string, run: WorkflowRun): Promise<void> {
  await mkdir(workflowRunsDir(vaultRoot), { recursive: true });
  await writeFile(workflowRunPath(vaultRoot, run.runId), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export async function listWorkflowRuns(vaultRoot: string): Promise<WorkflowRun[]> {
  const files = await fg("*.json", {
    cwd: workflowRunsDir(vaultRoot),
    absolute: true,
    suppressErrors: true,
  });
  const runs: WorkflowRun[] = [];
  for (const path of files) {
    const raw = await readFile(path, "utf8");
    runs.push(JSON.parse(raw) as WorkflowRun);
  }
  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createWorkflowRun(
  vaultRoot: string,
  input: {
    taskId: string;
    taskPath: string;
    title: string;
    initialStage?: WorkflowStage;
    definition?: WorkflowDefinition;
  },
): Promise<WorkflowRun> {
  const definition = input.definition ?? DEFAULT_WORKFLOW_DEFINITION;
  const now = new Date().toISOString();
  const runId = `wf-${safeTimestampId(now)}-${Math.random().toString(36).slice(2, 8)}`;
  const initialStage = input.initialStage ?? definition.initialStage;
  if (!resolveStageDefinition(definition, initialStage)) {
    throw new Error(`Initial workflow stage "${initialStage}" is not defined in workflow definition.`);
  }

  const run: WorkflowRun = {
    runId,
    taskId: input.taskId,
    taskPath: input.taskPath,
    title: input.title,
    definitionId: definition.id,
    definitionVersion: definition.version,
    status: "running",
    currentStage: initialStage,
    createdAt: now,
    updatedAt: now,
    events: [
      {
        id: eventId(runId, 1),
        at: now,
        stage: initialStage,
        type: "entered",
        summary: "Workflow created.",
      },
    ],
  };

  await saveWorkflowRun(vaultRoot, run);
  return run;
}

export async function loadWorkflowRun(vaultRoot: string, runId: string): Promise<WorkflowRun> {
  const raw = await readFile(workflowRunPath(vaultRoot, runId), "utf8");
  return JSON.parse(raw) as WorkflowRun;
}

export async function appendWorkflowEvent(
  vaultRoot: string,
  input: {
    runId: string;
    stage: WorkflowStage;
    type: WorkflowEventType;
    summary: string;
    details?: Record<string, unknown>;
  },
): Promise<WorkflowRun> {
  const run = await loadWorkflowRun(vaultRoot, input.runId);
  const now = new Date().toISOString();
  const nextEvent: WorkflowEvent = {
    id: eventId(run.runId, run.events.length + 1),
    at: now,
    stage: input.stage,
    type: input.type,
    summary: input.summary,
    details: input.details,
  };

  const next: WorkflowRun = {
    ...run,
    updatedAt: now,
    events: [...run.events, nextEvent],
  };
  await saveWorkflowRun(vaultRoot, next);
  return next;
}

export async function transitionWorkflowRun(
  vaultRoot: string,
  input: {
    runId: string;
    toStage: WorkflowStage;
    summary: string;
    details?: Record<string, unknown>;
    status?: WorkflowStatus;
    force?: boolean;
    definition?: WorkflowDefinition;
  },
): Promise<WorkflowRun> {
  const run = await loadWorkflowRun(vaultRoot, input.runId);
  const definition = input.definition ?? DEFAULT_WORKFLOW_DEFINITION;
  if (!input.force && !isAllowedTransition(definition, run.currentStage, input.toStage)) {
    throw new Error(
      `Illegal workflow transition: ${run.currentStage} -> ${input.toStage} under definition ${definition.id}@${definition.version}. Use force=true for manual override.`,
    );
  }

  const now = new Date().toISOString();
  const nextEvent: WorkflowEvent = {
    id: eventId(run.runId, run.events.length + 1),
    at: now,
    stage: input.toStage,
    type: "entered",
    summary: input.summary,
    details: input.details,
  };

  const next: WorkflowRun = {
    ...run,
    status: input.status ?? run.status,
    currentStage: input.toStage,
    updatedAt: now,
    events: [...run.events, nextEvent],
  };
  await saveWorkflowRun(vaultRoot, next);
  return next;
}
