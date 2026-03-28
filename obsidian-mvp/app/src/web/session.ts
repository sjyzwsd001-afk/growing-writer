import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "./http.js";

const SESSION_COOKIE_NAME = "gw_session";
const apiSessionToken = randomBytes(24).toString("hex");

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || "";
  return header
    .split(/;\s*/)
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const index = part.indexOf("=");
      if (index < 1) {
        return acc;
      }
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) {
        acc[key] = decodeURIComponent(value);
      }
      return acc;
    }, {});
}

function buildSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(apiSessionToken)}; Path=/; HttpOnly; SameSite=Strict`;
}

export function attachApiSessionCookie(res: ServerResponse): void {
  const existing = res.getHeader("Set-Cookie");
  const nextCookie = buildSessionCookie();
  if (!existing) {
    res.setHeader("Set-Cookie", nextCookie);
    return;
  }
  if (Array.isArray(existing)) {
    if (!existing.includes(nextCookie)) {
      res.setHeader("Set-Cookie", [...existing, nextCookie]);
    }
    return;
  }
  if (existing !== nextCookie) {
    res.setHeader("Set-Cookie", [String(existing), nextCookie]);
  }
}

export function ensureApiSession(req: IncomingMessage): void {
  if (process.env.GROWING_WRITER_DISABLE_SESSION_AUTH === "1") {
    return;
  }
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE_NAME] !== apiSessionToken) {
    throw new HttpError("Missing or invalid API session.", 401);
  }
}
