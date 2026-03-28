import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_VAULT_ROOT,
  OPENAI_CODEX_ALLOWED_MODELS,
} from "../config/constants.js";
import { matchMaterials, matchRules, matchRulesWithPolicy } from "../retrieve/matchers.js";
import {
  learnFeedback,
  learnFeedbackWithLlm,
  parseTask,
  parseTaskWithLlm,
} from "../workflows/stubs.js";
import {
  loadWorkflowRun,
} from "../workflows/orchestration.js";
import { loadWorkflowDefinition, saveWorkflowDefinition } from "../workflows/definition.js";
import { writeFeedbackResult } from "../writers/feedback-writer.js";
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import { refreshTaskReferences } from "../writers/task-refresh-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";
import { writeCandidateRule } from "../writers/rule-writer.js";
import { createFeedback } from "../writers/feedback-create-writer.js";
import { readMarkdownDocument, replaceSection, writeMarkdownDocument } from "../vault/markdown.js";
import { evaluateFeedbackAbsorption, persistFeedbackEvaluation } from "./feedback-evaluation.js";
import { HttpError, ensureLocalApiRequest, readBody, sendJson, sendText } from "./http.js";
import {
  handleDeleteLlmProfile,
  handleSaveLlmSettings,
  handleSelectLlmProfile,
  handleStartCodexOauth,
  handleTestLlmSettings,
} from "./llm-settings.js";
import {
  classifyMaterialRole,
  handleAnalyzeMaterial,
  handleAnalyzeMaterialsBatch,
  handleDeleteMaterials,
  handleDeleteMaterialsBatch,
  handleImportMaterials,
  handleUpdateMaterialRole,
  handleUpdateMaterialRoleBatch,
  normalizeTagList,
} from "./materials.js";
import { attachApiSessionCookie, ensureApiSession } from "./session.js";
import { serveStatic } from "./static.js";
import {
  handleDashboardRoute,
  handleDocumentRoute,
  handleRefreshProfileRoute,
  handleRefreshTasksRoute,
} from "./read-models.js";
import {
  handleCreateTaskRoute,
  handleRunTaskRoute,
  handleUpdateTaskDraftRoute,
} from "./tasks.js";
import {
  advanceWorkflowRunForAction,
  createAllAvailableLlmClients,
  createTaskFromRequest,
  runTaskAction,
  startWorkflowRunForTask,
  toTaskCreateRequest,
} from "./task-engine.js";
import { calibrateAndPersistLlmProfile, createLlmClient, runLlmConnectivityTest } from "./llm-runtime.js";
import { normalizeTaskFeedbackSignals } from "./task-feedback.js";
import {
  handleWorkflowAdvanceRoute,
  handleWorkflowDefinitionGetRoute,
  handleWorkflowDefinitionSaveRoute,
  handleWorkflowRunRoute,
  handleWorkflowStartRoute,
} from "./workflow.js";
import {
  handleCreateFeedbackRoute,
  handleEvaluateFeedbackRoute,
  handleLearnFeedbackRoute,
  handleRuleActionRoute,
  handleRuleRollbackRoute,
  handleRuleScopeRoute,
  handleRuleVersionsRoute,
} from "./rules-feedback.js";
import {
  applyRuleAction,
  applyRuleScopeUpdate,
  detectRuleConflictHints,
  listRuleVersions,
  rollbackRuleVersion,
} from "./rule-admin.js";
import {
  appendObservabilityEvent,
  readRecentObservabilityEvents,
} from "./observability.js";

type ServerOptions = {
  vaultRoot: string;
  port: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");


export async function startWebServer(options?: Partial<ServerOptions>) {
  const vaultRoot = resolve(options?.vaultRoot ?? DEFAULT_VAULT_ROOT);
  const port = options?.port ?? 4318;

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendText(res, 400, "Bad request");
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith("/api/")) {
        ensureLocalApiRequest(req);
        ensureApiSession(req);
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
        const staticPath = url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\/assets/, "");
        attachApiSessionCookie(res);
        await serveStatic(publicDir, res, staticPath);
        return;
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        attachApiSessionCookie(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        await handleDashboardRoute({
          vaultRoot,
          res,
          detectRuleConflictHints,
          listRuleVersions,
          readRecentObservabilityEvents,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleSaveLlmSettings({
          vaultRoot,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          calibrateProfile: calibrateAndPersistLlmProfile,
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/test") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleTestLlmSettings({
          vaultRoot,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          runConnectivityTest: runLlmConnectivityTest,
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/select") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleSelectLlmProfile({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/delete") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleDeleteLlmProfile({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/settings/llm/oauth/start") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleStartCodexOauth({
          vaultRoot,
          port,
          body,
          allowedModels: OPENAI_CODEX_ALLOWED_MODELS,
          calibrateProfile: calibrateAndPersistLlmProfile,
          res,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/document") {
        await handleDocumentRoute({
          targetPath: url.searchParams.get("path"),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/import") {
        const body = (await readBody(req)) as Record<string, string | string[] | undefined>;
        await handleImportMaterials({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/delete") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleDeleteMaterials({ vaultRoot, body, res });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/delete-batch") {
        const body = (await readBody(req)) as Record<string, string[] | undefined>;
        await handleDeleteMaterialsBatch({ vaultRoot, body, res });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/run") {
        await handleWorkflowRunRoute({
          vaultRoot,
          runId: url.searchParams.get("runId"),
          res,
          loadWorkflowRun,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/definition") {
        await handleWorkflowDefinitionGetRoute({
          vaultRoot,
          res,
          loadWorkflowDefinition,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/definition") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowDefinitionSaveRoute({
          vaultRoot,
          body,
          res,
          saveWorkflowDefinition,
          loadWorkflowDefinition,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/start") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowStartRoute({
          vaultRoot,
          body,
          res,
          toTaskCreateRequest,
          startWorkflowRunForTask,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workflow/advance") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleWorkflowAdvanceRoute({
          vaultRoot,
          body,
          res,
          advanceWorkflowRunForAction,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/create") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleCreateTaskRoute({
          vaultRoot,
          body,
          res,
          toTaskCreateRequest,
          createTaskFromRequest,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleAnalyzeMaterial({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze/batch") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleAnalyzeMaterialsBatch({
          vaultRoot,
          body,
          createClients: () => createAllAvailableLlmClients(vaultRoot),
          res,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/role") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleUpdateMaterialRole({
          vaultRoot,
          body,
          res,
          readMarkdownDocument,
          writeMarkdownDocument,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/role/batch") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleUpdateMaterialRoleBatch({
          vaultRoot,
          body,
          res,
          readMarkdownDocument,
          writeMarkdownDocument,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/run") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRunTaskRoute({
          vaultRoot,
          body,
          res,
          runTaskAction,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/update-draft") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleUpdateTaskDraftRoute({
          vaultRoot,
          body,
          res,
          replaceSection,
          writeMarkdownDocument,
          normalizeTaskFeedbackSignals,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/learn") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleLearnFeedbackRoute({
          vaultRoot,
          body,
          res,
          createLlmClient,
          parseTaskWithLlm,
          parseTask,
          learnFeedbackWithLlm,
          learnFeedback,
          writeCandidateRule,
          writeFeedbackResult,
          attachRuleToTask,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/create") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleCreateFeedbackRoute({
          vaultRoot,
          body,
          res,
          createFeedback,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/evaluate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleEvaluateFeedbackRoute({
          body,
          res,
          evaluateFeedbackAbsorption,
          persistFeedbackEvaluation,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/action") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRuleActionRoute({
          vaultRoot,
          body,
          res,
          applyRuleAction: (input) =>
            applyRuleAction({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/rules/versions") {
        await handleRuleVersionsRoute({
          vaultRoot,
          path: url.searchParams.get("path"),
          res,
          listRuleVersions,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/scope") {
        const body = (await readBody(req)) as Record<string, unknown>;
        await handleRuleScopeRoute({
          vaultRoot,
          body,
          res,
          normalizeTagList,
          applyRuleScopeUpdate: (input) =>
            applyRuleScopeUpdate({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/rollback") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        await handleRuleRollbackRoute({
          vaultRoot,
          body,
          res,
          rollbackRuleVersion: (input) =>
            rollbackRuleVersion({
              ...input,
              createAllAvailableLlmClients,
            }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/tasks") {
        await handleRefreshTasksRoute({
          vaultRoot,
          res,
          matchRulesWithPolicy,
          matchMaterials,
          refreshTaskReferences,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/profile") {
        await handleRefreshProfileRoute({
          vaultRoot,
          res,
          createLlmClient,
          refreshDefaultProfile,
        });
        return;
      }

      sendJson(res, 404, { error: `Unsupported route: ${url.pathname}` });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(res, 500, { error: message });
    }
  });

  return new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Writing assistant web console running at http://127.0.0.1:${port}`);
      resolvePromise();
    });
  });
}

const maybeRunDirectly = process.argv[1] === __filename;
if (maybeRunDirectly) {
  const portArg = process.argv.find((item) => item.startsWith("--port="));
  const vaultArg = process.argv.find((item) => item.startsWith("--vault="));

  await startWebServer({
    port: portArg ? Number(portArg.split("=")[1]) : 4318,
    vaultRoot: vaultArg ? resolve(vaultArg.split("=")[1]) : DEFAULT_VAULT_ROOT,
  });
}
