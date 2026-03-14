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
  parseTask,
  parseTaskWithLlm,
} from "../workflows/stubs.js";
import { writeTaskSections } from "../writers/task-writer.js";

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

    await writeTaskSections({ task, diagnosis });
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

    await writeTaskSections({ task, diagnosis, outline });
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

    await writeTaskSections({ task, diagnosis, outline, draft });
    console.log(JSON.stringify(draft, null, 2));
  });

program
  .command("learn-feedback")
  .argument("<feedback-file>", "path to feedback markdown file")
  .action(async (feedbackFile, options, command) => {
    const vaultRoot = resolve(command.parent?.opts().vault ?? DEFAULT_VAULT_ROOT);
    const repo = new VaultRepository(vaultRoot);
    const feedback = await repo.loadFeedback(resolve(feedbackFile));
    const analysis = learnFeedback(feedback);
    console.log(JSON.stringify(analysis, null, 2));
  });

await program.parseAsync(process.argv);
