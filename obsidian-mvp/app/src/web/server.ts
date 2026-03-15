import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_VAULT_ROOT } from "../config/constants.js";
import { getLlmConfig } from "../config/env.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible.js";
import { matchMaterials, matchRules } from "../retrieve/matchers.js";
import { VaultRepository } from "../vault/repository.js";
import {
  buildOutline,
  buildOutlineWithLlm,
  diagnoseTask,
  diagnoseTaskWithLlm,
  generateDraft,
  generateDraftWithLlm,
  learnFeedback,
  learnFeedbackWithLlm,
  parseTask,
  parseTaskWithLlm,
} from "../workflows/stubs.js";
import { writeFeedbackResult } from "../writers/feedback-writer.js";
import {
  analyzeImportedMaterial,
  createMaterialAnalyzer,
  extractTextFromBuffer,
  importMaterial,
} from "../writers/material-writer.js";
import { refreshDefaultProfile } from "../writers/profile-writer.js";
import {
  confirmRule,
  disableRule,
  rejectRule,
} from "../writers/rule-confirm-writer.js";
import { syncRuleInTasks } from "../writers/task-rule-sync-writer.js";
import { refreshTaskReferences } from "../writers/task-refresh-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { writeCandidateRule } from "../writers/rule-writer.js";
import { createTask } from "../writers/task-create-writer.js";

type ServerOptions = {
  vaultRoot: string;
  port: number;
};

type RuleAction = "confirm" | "disable" | "reject";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "public");

function createLlmClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig());
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function toSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function getStaticContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function serveStatic(res: ServerResponse, requestPath: string) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const localPath = join(publicDir, normalized);
  await access(localPath);
  res.writeHead(200, { "Content-Type": getStaticContentType(localPath) });
  createReadStream(localPath).pipe(res);
}

async function applyRuleAction(input: {
  action: RuleAction;
  vaultRoot: string;
  rulePath: string;
  reason?: string;
}) {
  const repo = new VaultRepository(input.vaultRoot);
  const [rule, rules, profiles, tasks] = await Promise.all([
    repo.loadRule(input.rulePath),
    repo.loadRules(),
    repo.loadProfiles(),
    repo.loadTasks(),
  ]);

  const updatedRule =
    input.action === "confirm"
      ? await confirmRule(rule, input.reason)
      : input.action === "disable"
        ? await disableRule(rule, input.reason)
        : await rejectRule(rule, input.reason);

  const updatedTasks = await syncRuleInTasks({
    tasks,
    ruleId: updatedRule.id,
    enabled: input.action === "confirm",
  });

  const profilePath = await refreshDefaultProfile({
    vaultRoot: input.vaultRoot,
    profiles,
    rules: rules.map((item) => (item.id === updatedRule.id ? updatedRule : item)),
  });

  return {
    rule: updatedRule,
    updatedTasks,
    profilePath,
  };
}

async function buildTaskSnapshot(vaultRoot: string, taskPath: string) {
  const repo = new VaultRepository(vaultRoot);
  const client = createLlmClient();
  const task = await repo.loadTask(taskPath);
  const [materials, rules, profiles] = await Promise.all([
    repo.loadMaterials(),
    repo.loadRules(),
    repo.loadProfiles(),
  ]);
  const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
  const matchedRules = matchRules(task, rules);
  const matchedMaterials = matchMaterials(task, materials);

  return {
    repo,
    client,
    task,
    profiles,
    analysis,
    matchedRules,
    matchedMaterials,
  };
}

async function runTaskAction(input: {
  vaultRoot: string;
  taskPath: string;
  action: "diagnose" | "outline" | "draft";
}) {
  const { client, task, profiles, analysis, matchedRules, matchedMaterials } = await buildTaskSnapshot(
    input.vaultRoot,
    input.taskPath,
  );

  const diagnosisInput = {
    task,
    analysis,
    matchedRules,
    matchedMaterials,
    profiles,
  };

  const diagnosis = client.isEnabled()
    ? await diagnoseTaskWithLlm(client, diagnosisInput)
    : diagnoseTask(diagnosisInput);

  if (input.action === "diagnose") {
    await writeTaskSections({
      task,
      diagnosis,
      matchedRules,
      matchedMaterials,
    });
    return { analysis, diagnosis };
  }

  const outlineInput = {
    task,
    analysis,
    diagnosis,
    matchedRules,
    matchedMaterials,
    profiles,
  };

  const outline = client.isEnabled()
    ? await buildOutlineWithLlm(client, outlineInput)
    : buildOutline(outlineInput);

  if (input.action === "outline") {
    await writeTaskSections({
      task,
      diagnosis,
      outline,
      matchedRules,
      matchedMaterials,
    });
    return { analysis, diagnosis, outline };
  }

  const draft = client.isEnabled()
    ? await generateDraftWithLlm(client, {
        task,
        analysis,
        diagnosis,
        outline,
        matchedRules,
        matchedMaterials,
        profiles,
      })
    : generateDraft({
        task,
        analysis,
        diagnosis,
        outline,
      });

  await writeTaskSections({
    task,
    diagnosis,
    outline,
    draft,
    matchedRules,
    matchedMaterials,
  });

  return { analysis, diagnosis, outline, draft };
}

async function buildDashboard(vaultRoot: string) {
  const repo = new VaultRepository(vaultRoot);
  const [materials, tasks, rules, feedbackEntries, profiles] = await Promise.all([
    repo.loadMaterials(),
    repo.loadTasks(),
    repo.loadRules(),
    repo.loadFeedbackEntries(),
    repo.loadProfiles(),
  ]);

  return {
    vaultRoot,
    llm_enabled: createLlmClient().isEnabled(),
    materials: materials
      .map((item) => ({
        id: item.id,
        title: item.title,
        docType: item.docType,
        audience: item.audience,
        scenario: item.scenario,
        quality: item.quality,
        path: item.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    tasks: tasks
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        docType: item.docType,
        audience: item.audience,
        scenario: item.scenario,
        matchedRules: item.matchedRules,
        path: item.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    rules: rules
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        scope: item.scope,
        confidence: item.confidence,
        path: item.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
    feedback: feedbackEntries
      .map((item) => ({
        id: item.id,
        taskId: item.taskId,
        feedbackType: item.feedbackType,
        relatedRuleIds: item.relatedRuleIds,
        path: item.path,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, "zh-CN")),
    profiles: profiles.map((item) => ({
      id: item.id,
      name: item.name,
      version: item.version,
      path: item.path,
    })),
  };
}

async function readDocumentByPath(path: string) {
  const raw = await readFile(path, "utf8");
  return { path, raw };
}

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

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
        const staticPath = url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\/assets/, "");
        await serveStatic(res, staticPath);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(res, 200, await buildDashboard(vaultRoot));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/document") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) {
          sendJson(res, 400, { error: "Missing path parameter." });
          return;
        }
        sendJson(res, 200, await readDocumentByPath(targetPath));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/import") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.title || !body.docType || (!body.body && !body.sourceFile && !body.uploadName)) {
          sendJson(res, 400, { error: "title、docType，以及正文/文件路径/浏览器上传文件至少要提供一项。" });
          return;
        }

        const client = createLlmClient();
        const analyzer = createMaterialAnalyzer(client);
        const uploadedBody =
          body.uploadName && body.uploadBase64
            ? await extractTextFromBuffer({
                fileName: body.uploadName,
                buffer: Buffer.from(body.uploadBase64, "base64"),
              })
            : "";
        const rawBody = body.body || uploadedBody;
        const analysis = rawBody
          ? await analyzer({
              title: body.title,
              rawBody,
              docType: body.docType,
              audience: body.audience,
              scenario: body.scenario,
            })
          : undefined;

        const result = await importMaterial({
          vaultRoot,
          title: body.title,
          docType: body.docType,
          audience: body.audience,
          scenario: body.scenario,
          source: body.source,
          quality: body.quality,
          body: rawBody,
          sourceFile: body.sourceFile ? resolve(body.sourceFile) : undefined,
          analysis,
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/create") {
        const body = (await readBody(req)) as Record<string, string | string[] | undefined>;
        if (!body.title || !body.docType) {
          sendJson(res, 400, { error: "title 和 docType 是必填项。" });
          return;
        }

        const repo = new VaultRepository(vaultRoot);
        const materials = await repo.loadMaterials();
        const selectedMaterialIds = Array.isArray(body.sourceMaterialIds)
          ? body.sourceMaterialIds.filter((item): item is string => typeof item === "string")
          : [];
        const selectedMaterials = materials.filter((item) => selectedMaterialIds.includes(item.id));

        const result = await createTask({
          vaultRoot,
          title: String(body.title),
          docType: String(body.docType),
          audience: typeof body.audience === "string" ? body.audience : "",
          scenario: typeof body.scenario === "string" ? body.scenario : "",
          priority: typeof body.priority === "string" ? body.priority : "medium",
          targetLength: typeof body.targetLength === "string" ? body.targetLength : "",
          deadline: typeof body.deadline === "string" ? body.deadline : "",
          goal: typeof body.goal === "string" ? body.goal : "",
          targetEffect: typeof body.targetEffect === "string" ? body.targetEffect : "",
          background: typeof body.background === "string" ? body.background : "",
          facts: typeof body.facts === "string" ? body.facts : "",
          mustInclude: typeof body.mustInclude === "string" ? body.mustInclude : "",
          specialRequirements:
            typeof body.specialRequirements === "string" ? body.specialRequirements : "",
          sourceMaterials: selectedMaterials,
        });

        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/materials/analyze") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path) {
          sendJson(res, 400, { error: "Missing material path." });
          return;
        }

        await analyzeImportedMaterial(resolve(body.path), {
          analyze: createMaterialAnalyzer(createLlmClient()),
        });
        sendJson(res, 200, { path: resolve(body.path), status: "analyzed" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/run") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path || !body.action) {
          sendJson(res, 400, { error: "Missing task path or action." });
          return;
        }

        const result = await runTaskAction({
          vaultRoot,
          taskPath: resolve(body.path),
          action: body.action as "diagnose" | "outline" | "draft",
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/learn") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path) {
          sendJson(res, 400, { error: "Missing feedback path." });
          return;
        }

        const repo = new VaultRepository(vaultRoot);
        const client = createLlmClient();
        const feedback = await repo.loadFeedback(resolve(body.path));
        const task = await repo.findTaskById(feedback.taskId);
        const taskAnalysis = task
          ? client.isEnabled()
            ? await parseTaskWithLlm(client, task)
            : parseTask(task)
          : null;
        const analysis = client.isEnabled()
          ? await learnFeedbackWithLlm(client, { feedback, task, taskAnalysis })
          : learnFeedback(feedback);
        const candidateRule = await writeCandidateRule({
          vaultRoot,
          feedback,
          analysis,
        });
        await writeFeedbackResult({
          feedback,
          analysis,
          ruleId: candidateRule?.ruleId ?? null,
        });
        if (task) {
          await attachRuleToTask({
            task,
            ruleId: candidateRule?.ruleId ?? null,
            feedbackId: feedback.id,
          });
        }
        sendJson(res, 200, {
          analysis,
          candidateRulePath: candidateRule?.path ?? null,
          candidateRuleId: candidateRule?.ruleId ?? null,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/rules/action") {
        const body = (await readBody(req)) as Record<string, string | undefined>;
        if (!body.path || !body.action) {
          sendJson(res, 400, { error: "Missing rule path or action." });
          return;
        }

        const result = await applyRuleAction({
          action: body.action as RuleAction,
          vaultRoot,
          rulePath: resolve(body.path),
          reason: body.reason,
        });
        sendJson(res, 200, {
          ruleId: result.rule.id,
          status: result.rule.status,
          profilePath: result.profilePath,
          updatedTasks: result.updatedTasks,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/tasks") {
        const repo = new VaultRepository(vaultRoot);
        const [tasks, materials, rules] = await Promise.all([
          repo.loadTasks(),
          repo.loadMaterials(),
          repo.loadRules(),
        ]);

        const results = [];
        for (const task of tasks) {
          const matchedRules = matchRules(task, rules);
          const matchedMaterials = matchMaterials(task, materials);
          await refreshTaskReferences({
            task,
            matchedRules,
            matchedMaterials,
          });
          results.push({
            taskId: task.id,
            matchedRules: matchedRules.map((rule) => rule.rule_id),
            matchedMaterials: matchedMaterials.map((material) => material.id),
          });
        }

        sendJson(res, 200, results);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/refresh/profile") {
        const repo = new VaultRepository(vaultRoot);
        const [profiles, rules] = await Promise.all([repo.loadProfiles(), repo.loadRules()]);
        const profilePath = await refreshDefaultProfile({
          vaultRoot,
          profiles,
          rules,
        });
        sendJson(res, 200, {
          profilePath,
          confirmedRules: rules.filter((rule) => rule.status === "confirmed").length,
        });
        return;
      }

      sendJson(res, 404, { error: `Unsupported route: ${toSafeId(url.pathname) || url.pathname}` });
    } catch (error) {
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
