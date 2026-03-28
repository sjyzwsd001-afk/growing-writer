import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PendingOauthRequest = {
  state: string;
  profileId: string;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  baseUrl: string;
  model: string;
  frontendOrigin: string;
  createdAt: number;
};

const pendingOauthRequests = new Map<string, PendingOauthRequest>();

function oauthPendingStatePath(vaultRoot: string): string {
  return join(vaultRoot, ".writer-oauth-pending.json");
}

export function getPendingOauthRequestCount(): number {
  return pendingOauthRequests.size;
}

async function persistPendingOauthRequests(vaultRoot: string): Promise<void> {
  const payload = JSON.stringify([...pendingOauthRequests.entries()], null, 2);
  await writeFile(oauthPendingStatePath(vaultRoot), payload, "utf8");
}

export async function loadPendingOauthRequests(vaultRoot: string): Promise<void> {
  if (pendingOauthRequests.size > 0) {
    return;
  }
  try {
    const raw = await readFile(oauthPendingStatePath(vaultRoot), "utf8");
    const parsed = JSON.parse(raw) as Array<[string, PendingOauthRequest]>;
    parsed.forEach(([state, request]) => {
      if (state && request?.state) {
        pendingOauthRequests.set(state, request);
      }
    });
  } catch {
    // Ignore missing or malformed persisted OAuth pending state.
  }
}

export async function setPendingOauthRequest(
  vaultRoot: string,
  value: PendingOauthRequest,
): Promise<void> {
  pendingOauthRequests.set(value.state, value);
  await persistPendingOauthRequests(vaultRoot);
}

export async function consumePendingOauthRequest(
  vaultRoot: string,
  state: string,
): Promise<PendingOauthRequest | null> {
  await loadPendingOauthRequests(vaultRoot);
  const pending = pendingOauthRequests.get(state) ?? null;
  if (pending) {
    pendingOauthRequests.delete(state);
    await persistPendingOauthRequests(vaultRoot);
  }
  return pending;
}
