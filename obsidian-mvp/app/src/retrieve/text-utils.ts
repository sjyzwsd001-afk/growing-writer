export function tokenizeForMatch(text: string): string[] {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return [];
  }
  const roughTokens = normalized
    .split(/[\s,.;:!?，。；：！？、（）()\[\]{}"'`~\-_/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  const hanChunks = [...normalized.matchAll(/[\u4e00-\u9fff]{2,8}/g)].map((item) => item[0]);
  const latinGroups = [...normalized.matchAll(/[a-z0-9]{3,}/g)].map((item) => item[0]);
  return [...new Set([...roughTokens, ...hanChunks, ...latinGroups])].slice(0, 18);
}
