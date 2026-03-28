import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export const MAX_REQUEST_BODY_BYTES = Number(
  process.env.GROWING_WRITER_MAX_BODY_BYTES || 5 * 1024 * 1024,
);

export function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function sendText(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new HttpError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`, 413);
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress || "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

export function ensureLocalApiRequest(req: IncomingMessage): void {
  if (process.env.GROWING_WRITER_ALLOW_REMOTE_API === "1") {
    return;
  }
  if (!isLoopbackRequest(req)) {
    throw new HttpError("This API only accepts localhost requests.", 403);
  }
}
