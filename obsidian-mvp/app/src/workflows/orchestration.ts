import fg from "fast-glob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WORKFLOW_STAGES = [
  "INTAKE_BACKGROUND",
  "INTAKE_MATERIALS",
  "SELECT_TEMPLATE",
  "GENERATE_DRAFT",
  "REVIEW_DIAGNOSE",
  "USER_CONFIRM_OR_EDIT",
  "FINALIZE_AND_LEARN",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
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

function stageIndex(stage: WorkflowStage): number {
  return WORKFLOW_STAGES.indexOf(stage);
}

function isForwardTransition(from: WorkflowStage, to: WorkflowStage): boolean {
  return stageIndex(to) === stageIndex(from) + 1;
}

function isAllowedTransition(from: WorkflowStage, to: WorkflowStage): boolean {
  if (from === to) {
    return true;
  }

  if (from === "USER_CONFIRM_OR_EDIT" && to === "GENERATE_DRAFT") {
    return true;
  }

  return isForwardTransition(from, to);
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
  },
): Promise<WorkflowRun> {
  const now = new Date().toISOString();
  const runId = `wf-${safeTimestampId(now)}-${Math.random().toString(36).slice(2, 8)}`;
  const initialStage = input.initialStage ?? "INTAKE_BACKGROUND";

  const run: WorkflowRun = {
    runId,
    taskId: input.taskId,
    taskPath: input.taskPath,
    title: input.title,
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
  },
): Promise<WorkflowRun> {
  const run = await loadWorkflowRun(vaultRoot, input.runId);
  if (!input.force && !isAllowedTransition(run.currentStage, input.toStage)) {
    throw new Error(
      `Illegal workflow transition: ${run.currentStage} -> ${input.toStage}. Use force=true for manual override.`,
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

