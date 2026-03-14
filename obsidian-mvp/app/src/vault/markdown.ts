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
  const marker = `# ${heading}`;
  const start = content.indexOf(marker);

  if (start >= 0) {
    const afterHeading = content.indexOf("\n\n", start);
    const bodyStart = afterHeading >= 0 ? afterHeading + 2 : start + marker.length;
    const nextHeadingIndex = content.indexOf("\n# ", bodyStart);
    const end = nextHeadingIndex >= 0 ? nextHeadingIndex : content.length;
    const before = content.slice(0, bodyStart);
    const after = content.slice(end);
    return `${before}${nextBody.trim()}\n${after}`;
  }

  return `${content.trim()}\n\n# ${heading}\n\n${nextBody.trim()}\n`;
}
