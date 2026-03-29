export const DEFAULT_API_TIMEOUT_MS = 30000;
export const MATERIAL_IMPORT_API_TIMEOUT_MS = 180000;
export const MATERIAL_BATCH_ANALYZE_BASE_TIMEOUT_MS = 120000;
export const WORKFLOW_START_TIMEOUT_MS = 90000;

export const trustedOrigins = new Set([
  window.location.origin,
  window.location.origin.replace("127.0.0.1", "localhost"),
  window.location.origin.replace("localhost", "127.0.0.1"),
]);

export async function api(path, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `请求超时（>${Math.round(timeoutMs / 1000)} 秒）。这通常表示文件解析或材料分析仍在进行；如果长时间反复出现，再重启 \`npm run web\` 后重试。`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
