#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";

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
import { writeCandidateRule } from "../writers/rule-writer.js";
import { writeFeedbackResult } from "../writers/feedback-writer.js";
import {
  confirmRule,
  disableRule,
  rejectRule,
  removeRuleFromDefaultProfile,
  updateDefaultProfileWithRule,
} from "../writers/rule-confirm-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";
import { syncRuleInTasks } from "../writers/task-rule-sync-writer.js";
import { refreshTaskReferences } from "../writers/task-refresh-writer.js";
import {
  analyzeImportedMaterial,
  createMaterialAnalyzer,
  importMaterial,
  importMaterialsFromDirectory,
} from "../writers/material-writer.js";

const program = new Command();

program
  .name("writer")
  .description("Obsidian 写作助手 MVP CLI")
  .option("--vault <path>", "vault root path", DEFAULT_VAULT_ROOT);

function createLlmClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient(getLlmConfig());
}

program
  .command("parse-task")
  .argument("<task-file>", "path to task markdown file")
  .action(async (taskFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const task = await repo.loadTask(resolve(taskFile));
    const client = createLlmClient();
    const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
    console.log(JSON.stringify(analysis, null, 2));
  });

program
  .command("diagnose")
  .argument("<task-file>", "path to task markdown file")
  .action(async (taskFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const task = await repo.loadTask(resolve(taskFile));
    const client = createLlmClient();
    const [materials, rules, profiles] = await Promise.all([
      repo.loadMaterials(),
      repo.loadRules(),
      repo.loadProfiles(),
    ]);
    const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
    const diagnosisInput = {
      task,
      analysis,
      matchedRules: matchRules(task, rules),
      matchedMaterials: matchMaterials(task, materials),
      profiles,
    };
    const diagnosis = client.isEnabled()
      ? await diagnoseTaskWithLlm(client, diagnosisInput)
      : diagnoseTask(diagnosisInput);

    await writeTaskSections({
      task,
      diagnosis,
      matchedRules: diagnosisInput.matchedRules,
      matchedMaterials: diagnosisInput.matchedMaterials,
    });
    console.log(JSON.stringify(diagnosis, null, 2));
  });

program
  .command("outline")
  .argument("<task-file>", "path to task markdown file")
  .action(async (taskFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const task = await repo.loadTask(resolve(taskFile));
    const client = createLlmClient();
    const [materials, rules, profiles] = await Promise.all([
      repo.loadMaterials(),
      repo.loadRules(),
      repo.loadProfiles(),
    ]);
    const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
    const matchedRules = matchRules(task, rules);
    const matchedMaterials = matchMaterials(task, materials);
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

    await writeTaskSections({
      task,
      diagnosis,
      outline,
      matchedRules,
      matchedMaterials,
    });
    console.log(JSON.stringify(outline, null, 2));
  });

program
  .command("draft")
  .argument("<task-file>", "path to task markdown file")
  .action(async (taskFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const task = await repo.loadTask(resolve(taskFile));
    const client = createLlmClient();
    const [materials, rules, profiles] = await Promise.all([
      repo.loadMaterials(),
      repo.loadRules(),
      repo.loadProfiles(),
    ]);
    const analysis = client.isEnabled() ? await parseTaskWithLlm(client, task) : parseTask(task);
    const matchedRules = matchRules(task, rules);
    const matchedMaterials = matchMaterials(task, materials);
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
      : generateDraft({ task, analysis, diagnosis, outline });

    await writeTaskSections({
      task,
      diagnosis,
      outline,
      draft,
      matchedRules,
      matchedMaterials,
    });
    console.log(JSON.stringify(draft, null, 2));
  });

program
  .command("confirm-rule")
  .argument("<rule-file>", "path to rule markdown file")
  .option("--reason <reason>", "reason for confirming this rule")
  .action(async (ruleFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const [rule, profiles, tasks] = await Promise.all([
      repo.loadRule(resolve(ruleFile)),
      repo.loadProfiles(),
      repo.loadTasks(),
    ]);
    const confirmedRule = await confirmRule(rule, options.reason);
    const profilePath = await updateDefaultProfileWithRule({
      vaultRoot,
      rule: confirmedRule,
      profiles,
    });
    const updatedTasks = await syncRuleInTasks({
      tasks,
      ruleId: confirmedRule.id,
      enabled: true,
    });

    console.log(
      JSON.stringify(
        {
          rule_id: confirmedRule.id,
          rule_path: confirmedRule.path,
          status: confirmedRule.status,
          profile_path: profilePath,
          updated_tasks: updatedTasks,
        },
        null,
        2,
      ),
    );
  });

program
  .command("reject-rule")
  .argument("<rule-file>", "path to rule markdown file")
  .option("--reason <reason>", "reason for rejecting this rule")
  .action(async (ruleFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const [rule, profiles, tasks] = await Promise.all([
      repo.loadRule(resolve(ruleFile)),
      repo.loadProfiles(),
      repo.loadTasks(),
    ]);
    const rejectedRule = await rejectRule(rule, options.reason);
    const profilePath = await removeRuleFromDefaultProfile({
      vaultRoot,
      rule: rejectedRule,
      profiles,
    });
    const updatedTasks = await syncRuleInTasks({
      tasks,
      ruleId: rejectedRule.id,
      enabled: false,
    });

    console.log(
      JSON.stringify(
        {
          rule_id: rejectedRule.id,
          rule_path: rejectedRule.path,
          status: rejectedRule.status,
          profile_path: profilePath,
          updated_tasks: updatedTasks,
        },
        null,
        2,
      ),
    );
  });

program
  .command("disable-rule")
  .argument("<rule-file>", "path to rule markdown file")
  .option("--reason <reason>", "reason for disabling this rule")
  .action(async (ruleFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const [rule, profiles, tasks] = await Promise.all([
      repo.loadRule(resolve(ruleFile)),
      repo.loadProfiles(),
      repo.loadTasks(),
    ]);
    const disabledRule = await disableRule(rule, options.reason);
    const profilePath = await removeRuleFromDefaultProfile({
      vaultRoot,
      rule: disabledRule,
      profiles,
    });
    const updatedTasks = await syncRuleInTasks({
      tasks,
      ruleId: disabledRule.id,
      enabled: false,
    });

    console.log(
      JSON.stringify(
        {
          rule_id: disabledRule.id,
          rule_path: disabledRule.path,
          status: disabledRule.status,
          profile_path: profilePath,
          updated_tasks: updatedTasks,
        },
        null,
        2,
      ),
    );
  });

program
  .command("list-rules")
  .option("--status <status>", "filter by status: candidate | confirmed | disabled")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const rules = await repo.loadRules();
    const filtered = options.status
      ? rules.filter((rule) => rule.status === options.status)
      : rules;

    const items = filtered
      .map((rule) => ({
        id: rule.id,
        title: rule.title,
        status: rule.status,
        scope: rule.scope,
        confidence: rule.confidence,
        path: rule.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }

    if (!items.length) {
      console.log("No rules found.");
      return;
    }

    const lines = items.map(
      (rule) =>
        `- [${rule.status}] ${rule.title} (${rule.id}) | scope=${rule.scope || "n/a"} | confidence=${rule.confidence}`,
    );
    console.log(lines.join("\n"));
  });

program
  .command("list-tasks")
  .option("--status <status>", "filter by task status")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const tasks = await repo.loadTasks();
    const filtered = options.status
      ? tasks.filter((task) => task.status === options.status)
      : tasks;

    const items = filtered
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        doc_type: task.docType,
        audience: task.audience,
        scenario: task.scenario,
        matched_rules: task.matchedRules,
        path: task.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }

    if (!items.length) {
      console.log("No tasks found.");
      return;
    }

    const lines = items.map(
      (task) =>
        `- [${task.status}] ${task.title} (${task.id}) | type=${task.doc_type || "n/a"} | audience=${task.audience || "n/a"} | matched_rules=${task.matched_rules.length}`,
    );
    console.log(lines.join("\n"));
  });

program
  .command("list-feedback")
  .option("--type <feedbackType>", "filter by feedback type")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const feedbackEntries = await repo.loadFeedbackEntries();
    const filtered = options.type
      ? feedbackEntries.filter((entry) => entry.feedbackType === options.type)
      : feedbackEntries;

    const items = filtered
      .map((entry) => ({
        id: entry.id,
        task_id: entry.taskId,
        feedback_type: entry.feedbackType || "unclassified",
        related_rule_ids: entry.relatedRuleIds,
        path: entry.path,
      }))
      .sort((a, b) => a.id.localeCompare(b.id, "zh-CN"));

    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }

    if (!items.length) {
      console.log("No feedback found.");
      return;
    }

    const lines = items.map(
      (entry) =>
        `- [${entry.feedback_type}] ${entry.id} | task=${entry.task_id || "n/a"} | related_rules=${entry.related_rule_ids.length}`,
    );
    console.log(lines.join("\n"));
  });

program
  .command("list-materials")
  .option("--doc-type <docType>", "filter by document type")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const materials = await repo.loadMaterials();
    const filtered = options.docType
      ? materials.filter((material) => material.docType === options.docType)
      : materials;

    const items = filtered
      .map((material) => ({
        id: material.id,
        title: material.title,
        doc_type: material.docType,
        audience: material.audience,
        scenario: material.scenario,
        quality: material.quality,
        path: material.path,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }

    if (!items.length) {
      console.log("No materials found.");
      return;
    }

    const lines = items.map(
      (material) =>
        `- ${material.title} (${material.id}) | type=${material.doc_type || "n/a"} | audience=${material.audience || "n/a"} | quality=${material.quality}`,
    );
    console.log(lines.join("\n"));
  });

program
  .command("import-material")
  .requiredOption("--title <title>", "material title")
  .requiredOption("--doc-type <docType>", "material document type")
  .option("--audience <audience>", "target audience")
  .option("--scenario <scenario>", "usage scenario")
  .option("--source <source>", "source description")
  .option("--quality <quality>", "quality label", "high")
  .option("--body <body>", "material body text")
  .option("--source-file <path>", "read material body from a local text or markdown file")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const client = createLlmClient();
    const analyzer = createMaterialAnalyzer(client);
    const analysis = options.body
      ? await analyzer({
          title: options.title,
          rawBody: options.body,
          docType: options.docType,
          audience: options.audience,
          scenario: options.scenario,
        })
      : undefined;
    const result = await importMaterial({
      vaultRoot,
      title: options.title,
      docType: options.docType,
      audience: options.audience,
      scenario: options.scenario,
      source: options.source,
      quality: options.quality,
      body: options.body,
      sourceFile: options.sourceFile ? resolve(options.sourceFile) : undefined,
      analysis,
    });

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("import-materials-dir")
  .requiredOption("--source-dir <sourceDir>", "directory containing .txt/.md/.docx/.pdf materials")
  .requiredOption("--doc-type <docType>", "material document type")
  .option("--audience <audience>", "target audience")
  .option("--scenario <scenario>", "usage scenario")
  .option("--source <source>", "source description override")
  .option("--quality <quality>", "quality label", "high")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const client = createLlmClient();
    const results = await importMaterialsFromDirectory({
      vaultRoot,
      sourceDir: resolve(options.sourceDir),
      docType: options.docType,
      audience: options.audience,
      scenario: options.scenario,
      source: options.source,
      quality: options.quality,
      analyze: createMaterialAnalyzer(client),
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (!results.length) {
      console.log("No materials imported.");
      return;
    }

    console.log(results.map((item) => `- ${item.materialId} <- ${item.sourceFile}`).join("\n"));
  });

program
  .command("analyze-material")
  .argument("<material-file>", "path to imported material markdown file")
  .action(async (materialFile) => {
    const client = createLlmClient();
    await analyzeImportedMaterial(resolve(materialFile), {
      analyze: createMaterialAnalyzer(client),
    });
    console.log(
      JSON.stringify(
        {
          material_path: resolve(materialFile),
          status: "analyzed",
        },
        null,
        2,
      ),
    );
  });

program
  .command("refresh-tasks")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const [tasks, materials, rules] = await Promise.all([
      repo.loadTasks(),
      repo.loadMaterials(),
      repo.loadRules(),
    ]);

    const results: Array<{
      task_id: string;
      path: string;
      matched_rules: string[];
      matched_materials: string[];
    }> = [];

    for (const task of tasks) {
      const matchedRules = matchRules(task, rules);
      const matchedMaterials = matchMaterials(task, materials);
      await refreshTaskReferences({
        task,
        matchedRules,
        matchedMaterials,
      });
      results.push({
        task_id: task.id,
        path: task.path,
        matched_rules: matchedRules.map((rule) => rule.rule_id),
        matched_materials: matchedMaterials.map((material) => material.id),
      });
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (!results.length) {
      console.log("No tasks refreshed.");
      return;
    }

    console.log(
      results
        .map(
          (result) =>
            `- ${result.task_id} | matched_rules=${result.matched_rules.length} | matched_materials=${result.matched_materials.length}`,
        )
        .join("\n"),
    );
  });

program
  .command("learn-feedback")
  .argument("<feedback-file>", "path to feedback markdown file")
  .action(async (feedbackFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const client = createLlmClient();
    const feedback = await repo.loadFeedback(resolve(feedbackFile));
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
    console.log(
      JSON.stringify(
        {
          analysis,
          candidate_rule_path: candidateRule?.path ?? null,
          candidate_rule_id: candidateRule?.ruleId ?? null,
        },
        null,
        2,
      ),
    );
  });

await program.parseAsync(process.argv);
