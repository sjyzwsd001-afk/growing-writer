import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

function resolveDefaultVaultRoot(): string {
  const explicit = process.env.GROWING_WRITER_VAULT_ROOT?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const obsidianConfigPath = resolve(homedir(), "Library/Application Support/obsidian/obsidian.json");
  if (existsSync(obsidianConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(obsidianConfigPath, "utf8")) as {
        vaults?: Record<string, { path?: string; open?: boolean; ts?: number }>;
      };
      const vaultEntries = Object.values(raw.vaults ?? {}).filter(
        (item): item is { path: string; open?: boolean; ts?: number } =>
          typeof item?.path === "string" && item.path.trim().length > 0,
      );
      const preferred =
        vaultEntries.find((item) => item.open) ??
        vaultEntries.sort((left, right) => Number(right.ts ?? 0) - Number(left.ts ?? 0))[0];
      if (preferred?.path) {
        return resolve(preferred.path);
      }
    } catch {
      // Fall back to the local repo vault when Obsidian config cannot be parsed.
    }
  }

  return resolve(process.cwd(), "..");
}

export const DEFAULT_VAULT_ROOT = resolveDefaultVaultRoot();
export const LLM_SETTINGS_FILE_NAME = ".writer-llm-config.json";
export const OPENAI_CODEX_PROVIDER = "openai-codex-oauth";
export const OPENAI_CODEX_PROVIDER_LABEL = "OpenAI Codex OAuth";
export const OPENAI_KEY_PROVIDER = "openai-api-key";
export const OPENAI_KEY_PROVIDER_LABEL = "OpenAI API Key";
export const OPENAI_CODEX_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_AUTH_URL = `${OPENAI_CODEX_ISSUER}/oauth/authorize`;
export const OPENAI_CODEX_TOKEN_URL = `${OPENAI_CODEX_ISSUER}/oauth/token`;
export const OPENAI_CODEX_CLIENT_ID =
  process.env.OPENAI_CODEX_CLIENT_ID?.trim() || "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
export const OPENAI_CODEX_ORIGINATOR = process.env.OPENAI_CODEX_ORIGINATOR?.trim() || "pi";
export const OPENAI_CODEX_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_CODEX_MODEL = process.env.OPENAI_CODEX_MODEL?.trim() || "gpt-5.4";
export const OPENAI_CODEX_ALLOWED_MODELS = (
  process.env.OPENAI_CODEX_ALLOWED_MODELS?.split(",").map((item) => item.trim()).filter(Boolean) || [
    "gpt-5.4",
    "gpt-5.3-codex",
  ]
) as readonly string[];
export const OPENAI_CODEX_CALLBACK_PORT = Number(process.env.OPENAI_CODEX_CALLBACK_PORT || 1455);

export const TASK_SECTIONS = [
  "写前诊断",
  "参考依据",
  "提纲",
  "初稿",
  "修改记录",
] as const;

export const RULE_STATUS = ["candidate", "confirmed", "disabled"] as const;
