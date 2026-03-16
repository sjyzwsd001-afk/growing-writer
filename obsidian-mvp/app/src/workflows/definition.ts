import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WORKFLOW_DEFINITION_RELATIVE_PATH = "workflow/workflow-definition.json";

export type WorkflowStageDefinition = {
  id: string;
  label: string;
  description?: string;
  next: string[];
  actions?: Record<string, string>;
};

export type WorkflowDefinition = {
  id: string;
  version: number;
  initialStage: string;
  stages: WorkflowStageDefinition[];
};

export const DEFAULT_WORKFLOW_DEFINITION: WorkflowDefinition = {
  id: "growing-writer-default",
  version: 1,
  initialStage: "INTAKE_BACKGROUND",
  stages: [
    {
      id: "INTAKE_BACKGROUND",
      label: "问背景",
      description: "收集背景、目标、约束",
      next: ["INTAKE_MATERIALS"],
    },
    {
      id: "INTAKE_MATERIALS",
      label: "问材料",
      description: "收集历史材料、补充事实",
      next: ["SELECT_TEMPLATE"],
    },
    {
      id: "SELECT_TEMPLATE",
      label: "问模板",
      description: "选择模板与结构偏好",
      next: ["GENERATE_DRAFT"],
    },
    {
      id: "GENERATE_DRAFT",
      label: "写作",
      description: "生成诊断、提纲与初稿",
      next: ["REVIEW_DIAGNOSE"],
    },
    {
      id: "REVIEW_DIAGNOSE",
      label: "检查",
      description: "执行规则裁决与诊断复核",
      next: ["USER_CONFIRM_OR_EDIT"],
    },
    {
      id: "USER_CONFIRM_OR_EDIT",
      label: "确认",
      description: "用户修改、批注、反馈",
      next: ["FINALIZE_AND_LEARN"],
      actions: {
        regenerate: "GENERATE_DRAFT",
        finalize: "FINALIZE_AND_LEARN",
      },
    },
    {
      id: "FINALIZE_AND_LEARN",
      label: "定稿",
      description: "定稿并学习反馈",
      next: [],
    },
  ],
};

function normalizeStage(input: unknown): WorkflowStageDefinition {
  const value = input as Record<string, unknown>;
  const actions =
    value.actions && typeof value.actions === "object" && !Array.isArray(value.actions)
      ? Object.fromEntries(
          Object.entries(value.actions).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    id: typeof value.id === "string" ? value.id : "",
    label: typeof value.label === "string" ? value.label : "",
    description: typeof value.description === "string" ? value.description : "",
    next: Array.isArray(value.next)
      ? value.next.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    ...(Object.keys(actions).length ? { actions } : {}),
  };
}

export function normalizeWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const input = raw as Record<string, unknown>;
  const stages = Array.isArray(input.stages) ? input.stages.map(normalizeStage) : [];
  if (!stages.length) {
    return null;
  }

  const stageIds = new Set(stages.map((stage) => stage.id).filter(Boolean));
  if (!stageIds.size) {
    return null;
  }

  const initialStage =
    typeof input.initialStage === "string" && stageIds.has(input.initialStage)
      ? input.initialStage
      : stages[0].id;

  const sanitizedStages = stages.map((stage) => ({
    ...stage,
    next: stage.next.filter((id) => stageIds.has(id)),
    ...(Object.keys(stage.actions ?? {}).length
      ? {
          actions: Object.fromEntries(
            Object.entries(stage.actions ?? {}).filter((entry) => stageIds.has(entry[1])),
          ),
        }
      : {}),
  }));

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : DEFAULT_WORKFLOW_DEFINITION.id,
    version:
      typeof input.version === "number" && Number.isFinite(input.version) && input.version > 0
        ? Math.floor(input.version)
        : DEFAULT_WORKFLOW_DEFINITION.version,
    initialStage,
    stages: sanitizedStages,
  };
}

export function workflowDefinitionPath(vaultRoot: string): string {
  return join(vaultRoot, WORKFLOW_DEFINITION_RELATIVE_PATH);
}

export function parseWorkflowDefinitionOrThrow(raw: unknown): WorkflowDefinition {
  const normalized = normalizeWorkflowDefinition(raw);
  if (!normalized) {
    throw new Error(
      "Invalid workflow definition. Ensure id/version/initialStage/stages are provided with valid stage ids.",
    );
  }

  const ids = normalized.stages.map((stage) => stage.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(`Workflow stages contain duplicate ids: ${[...new Set(duplicates)].join(", ")}`);
  }

  const invalidStages = normalized.stages.filter((stage) => !stage.id || !stage.label);
  if (invalidStages.length) {
    throw new Error("Each workflow stage must include non-empty id and label.");
  }

  return normalized;
}

export async function loadWorkflowDefinition(vaultRoot: string): Promise<{
  definition: WorkflowDefinition;
  source: "file" | "default";
  path: string;
}> {
  const path = workflowDefinitionPath(vaultRoot);
  try {
    await access(path);
    const raw = await readFile(path, "utf8");
    const parsed = normalizeWorkflowDefinition(JSON.parse(raw));
    if (parsed) {
      return { definition: parsed, source: "file", path };
    }
  } catch {
    // fall through to default definition
  }

  return {
    definition: DEFAULT_WORKFLOW_DEFINITION,
    source: "default",
    path,
  };
}

export async function saveWorkflowDefinition(vaultRoot: string, raw: unknown): Promise<{
  definition: WorkflowDefinition;
  path: string;
}> {
  const definition = parseWorkflowDefinitionOrThrow(raw);
  const path = workflowDefinitionPath(vaultRoot);
  await mkdir(join(vaultRoot, "workflow"), { recursive: true });
  await writeFile(path, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  return { definition, path };
}

export function resolveStageDefinition(
  definition: WorkflowDefinition,
  stageId: string,
): WorkflowStageDefinition | null {
  return definition.stages.find((stage) => stage.id === stageId) ?? null;
}
