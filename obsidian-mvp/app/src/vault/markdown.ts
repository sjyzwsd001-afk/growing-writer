import { readFile, writeFile } from "node:fs/promises";
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
  await writeFile(path, serialized, "utf8");
}

export function replaceSection(content: string, heading: string, nextBody: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^# ${escaped}\\n\\n)([\\s\\S]*?)(?=\\n# |$)`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, `$1${nextBody.trim()}\n\n`);
  }

  return `${content.trim()}\n\n## ${heading}\n\n${nextBody.trim()}\n`;
}
