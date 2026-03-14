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
import { confirmRule, updateDefaultProfileWithRule } from "../writers/rule-confirm-writer.js";
import { writeTaskSections } from "../writers/task-writer.js";
import { attachRuleToTask } from "../writers/task-link-writer.js";

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
  .action(async (ruleFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const [rule, profiles] = await Promise.all([
      repo.loadRule(resolve(ruleFile)),
      repo.loadProfiles(),
    ]);
    const confirmedRule = await confirmRule(rule);
    const profilePath = await updateDefaultProfileWithRule({
      vaultRoot,
      rule: confirmedRule,
      profiles,
    });

    console.log(
      JSON.stringify(
        {
          rule_id: confirmedRule.id,
          rule_path: confirmedRule.path,
          status: confirmedRule.status,
          profile_path: profilePath,
        },
        null,
        2,
      ),
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
