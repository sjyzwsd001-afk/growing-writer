import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import matter from "gray-matter";

import type { Frontmatter, MarkdownDocument } from "../types/domain.js";

export async function readMarkdownDocument(path: string): Promise<MarkdownDocument> {
  const raw = await readFile(path, "utf8");
  const parsed = matter(raw);

  return {
    path,
    frontmatter: parsed.data as Frontmatter,
    content: parsed.content.trim(),
  };
}

export async function writeMarkdownDocument(
  path: string,
  frontmatter: Frontmatter,
  content: string,
): Promise<void> {
  const serialized = matter.stringify(content.trim() + "\n", frontmatter);
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, path);
}

export function replaceSection(content: string, heading: string, nextBody: string): string {
  const headingPattern = new RegExp(`^(#{1,6})\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = headingPattern.exec(content);

  if (match && typeof match.index === "number") {
    const marker = match[0];
    const level = match[1] || "#";
    const start = match.index;
    const bodyStart = start + marker.length + (content.slice(start + marker.length, start + marker.length + 2) === "\n\n" ? 2 : 1);
    const nextHeadingIndex = content.slice(bodyStart).search(new RegExp(`^#{1,${level.length}}\\s+`, "m"));
    const end = nextHeadingIndex >= 0 ? bodyStart + nextHeadingIndex : content.length;
    const before = content.slice(0, bodyStart);
    const after = content.slice(end).replace(/^\n+/, "");
    return `${before}${nextBody.trim()}\n\n${after}`;
  }

  return `${content.trim()}\n\n# ${heading}\n\n${nextBody.trim()}\n`;
}
