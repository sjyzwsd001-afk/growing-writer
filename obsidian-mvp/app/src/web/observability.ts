import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ObservabilityEvent = {
  id: string;
  at: string;
  taskId: string;
  taskPath: string;
  stage: string;
  action: "diagnose" | "outline" | "draft";
  usedModel: string;
  triedModels: string[];
  durationMs: number;
  success: boolean;
  errors: string[];
  matchedRuleCount: number;
  matchedMaterialCount: number;
  evidenceCardCount: number;
};

function observabilityLogPath(vaultRoot: string): string {
  return join(vaultRoot, "observability", "llm-events.jsonl");
}

export async function appendObservabilityEvent(vaultRoot: string, event: ObservabilityEvent): Promise<void> {
  const path = observabilityLogPath(vaultRoot);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readRecentObservabilityEvents(vaultRoot: string, limit = 80): Promise<ObservabilityEvent[]> {
  try {
    const raw = await readFile(observabilityLogPath(vaultRoot), "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean);
    const items: ObservabilityEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        items.push(JSON.parse(line) as ObservabilityEvent);
      } catch {
        // ignore malformed lines
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}
