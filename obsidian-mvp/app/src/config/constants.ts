import { resolve } from "node:path";

export const DEFAULT_VAULT_ROOT = resolve(process.cwd(), "..");
export const LLM_SETTINGS_FILE_NAME = ".writer-llm-config.json";

export const TASK_SECTIONS = [
  "写前诊断",
  "参考依据",
  "提纲",
  "初稿",
  "修改记录",
] as const;

export const RULE_STATUS = ["candidate", "confirmed", "disabled"] as const;
