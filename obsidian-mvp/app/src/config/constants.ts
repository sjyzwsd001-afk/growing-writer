import { resolve } from "node:path";

export const DEFAULT_VAULT_ROOT = resolve(process.cwd(), "..");
export const LLM_SETTINGS_FILE_NAME = ".writer-llm-config.json";
export const OPENAI_CODEX_PROVIDER = "openai-codex-oauth";
export const OPENAI_CODEX_PROVIDER_LABEL = "OpenAI Codex OAuth";
export const OPENAI_CODEX_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_AUTH_URL = `${OPENAI_CODEX_ISSUER}/oauth/authorize`;
export const OPENAI_CODEX_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/oauth/token`;
export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
export const OPENAI_CODEX_ORIGINATOR = "codex_cli_rs";
export const OPENAI_CODEX_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_CODEX_MODEL = "gpt-5-codex";

export const TASK_SECTIONS = [
  "写前诊断",
  "参考依据",
  "提纲",
  "初稿",
  "修改记录",
] as const;

export const RULE_STATUS = ["candidate", "confirmed", "disabled"] as const;
