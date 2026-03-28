import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";

function getStaticContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

export async function serveStatic(publicDir: string, res: ServerResponse, requestPath: string) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const localPath = join(publicDir, normalized);
  await access(localPath);
  res.writeHead(200, { "Content-Type": getStaticContentType(localPath) });
  createReadStream(localPath).pipe(res);
}
