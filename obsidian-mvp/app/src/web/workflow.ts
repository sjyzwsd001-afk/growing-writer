import { sendJson } from "./http.js";

type WorkflowAdvanceAction = "regenerate" | "finalize";

type TaskCreateRequestLike = {
  title: string;
  docType: string;
  [key: string]: unknown;
};

type WorkflowTaskCreateInput = TaskCreateRequestLike & {
  audience: string;
  scenario: string;
  priority: string;
  targetLength: string;
  deadline: string;
  goal: string;
  targetEffect: string;
  background: string;
  facts: string;
  mustInclude: string;
  specialRequirements: string;
  templateId: string;
  templateMode: "strict" | "hybrid" | "light";
  templateOverrides: string;
  sourceMaterialIds: string[];
};

export async function handleWorkflowRunRoute(input: {
  vaultRoot: string;
  runId: string | null;
  res: Parameters<typeof sendJson>[0];
  loadWorkflowRun: (vaultRoot: string, runId: string) => Promise<unknown>;
}) {
  if (!input.runId) {
    sendJson(input.res, 400, { error: "Missing runId parameter." });
    return true;
  }
  const run = await input.loadWorkflowRun(input.vaultRoot, input.runId);
  sendJson(input.res, 200, { run });
  return true;
}

export async function handleWorkflowDefinitionGetRoute(input: {
  vaultRoot: string;
  res: Parameters<typeof sendJson>[0];
  loadWorkflowDefinition: (vaultRoot: string) => Promise<unknown>;
}) {
  const workflowDefinition = await input.loadWorkflowDefinition(input.vaultRoot);
  sendJson(input.res, 200, workflowDefinition);
  return true;
}

export async function handleWorkflowDefinitionSaveRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  saveWorkflowDefinition: (vaultRoot: string, rawDefinition: unknown) => Promise<unknown>;
  loadWorkflowDefinition: (vaultRoot: string) => Promise<unknown>;
}) {
  const rawDefinition = input.body.definition ?? input.body;
  const saved = await input.saveWorkflowDefinition(input.vaultRoot, rawDefinition);
  const reloaded = await input.loadWorkflowDefinition(input.vaultRoot);
  sendJson(input.res, 200, {
    saved,
    reloaded,
  });
  return true;
}

export async function handleWorkflowStartRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  toTaskCreateRequest: (body: Record<string, unknown>) => WorkflowTaskCreateInput;
  startWorkflowRunForTask: (input: { vaultRoot: string; request: WorkflowTaskCreateInput }) => Promise<unknown>;
}) {
  const request = input.toTaskCreateRequest(input.body);
  if (!request.title || !request.docType) {
    sendJson(input.res, 400, { error: "title 和 docType 是必填项。" });
    return true;
  }

  const result = await input.startWorkflowRunForTask({
    vaultRoot: input.vaultRoot,
    request,
  });
  sendJson(input.res, 200, result);
  return true;
}

export async function handleWorkflowAdvanceRoute(input: {
  vaultRoot: string;
  body: Record<string, unknown>;
  res: Parameters<typeof sendJson>[0];
  advanceWorkflowRunForAction: (input: {
    vaultRoot: string;
    runId: string;
    action: WorkflowAdvanceAction;
    taskPath?: string;
  }) => Promise<unknown>;
}) {
  const runId = typeof input.body.runId === "string" ? input.body.runId : "";
  const action = typeof input.body.action === "string" ? input.body.action : "";
  const taskPath = typeof input.body.taskPath === "string" ? input.body.taskPath : undefined;

  if (!runId || !action) {
    sendJson(input.res, 400, { error: "Missing runId or action." });
    return true;
  }

  if (action !== "regenerate" && action !== "finalize") {
    sendJson(input.res, 400, { error: "Unsupported workflow action." });
    return true;
  }

  const result = await input.advanceWorkflowRunForAction({
    vaultRoot: input.vaultRoot,
    runId,
    action,
    taskPath,
  });
  sendJson(input.res, 200, result);
  return true;
}
