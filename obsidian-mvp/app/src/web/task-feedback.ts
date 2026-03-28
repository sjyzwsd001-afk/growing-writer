type TaskFeedbackSignal = {
  count: number;
  latest_reason: string;
  latest_updated_at: string;
  latest_version: string;
  recent_reasons: string[];
};

export function normalizeTaskFeedbackSignals(value: unknown): Record<string, TaskFeedbackSignal> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, TaskFeedbackSignal> = {};
  for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const count = typeof entry.count === "number" ? entry.count : Number(entry.count ?? 0);
    result[key] = {
      count: Number.isFinite(count) ? Math.max(0, count) : 0,
      latest_reason:
        typeof entry.latest_reason === "string"
          ? entry.latest_reason
          : typeof entry.reason === "string"
            ? entry.reason
            : "",
      latest_updated_at:
        typeof entry.latest_updated_at === "string"
          ? entry.latest_updated_at
          : typeof entry.updated_at === "string"
            ? entry.updated_at
            : "",
      latest_version:
        typeof entry.latest_version === "string"
          ? entry.latest_version
          : typeof entry.version === "string"
            ? entry.version
            : "",
      recent_reasons: Array.isArray(entry.recent_reasons)
        ? entry.recent_reasons.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  return result;
}
