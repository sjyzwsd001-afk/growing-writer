import type { EvidenceCard, Material, MaterialSummary, Task } from "../types/domain.js";

function takeLines(content: string, count: number): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count);
}

export function summarizeMaterial(material: Material): MaterialSummary {
  return {
    material_id: material.id,
    title: material.title,
    doc_type: material.docType,
    structure_summary: takeLines(material.content, 3),
    style_summary: [
      material.quality ? `质量标记：${material.quality}` : "",
      material.audience ? `面向对象：${material.audience}` : "",
      material.scenario ? `场景：${material.scenario}` : "",
    ].filter(Boolean),
    useful_phrases: takeLines(material.content, 2),
  };
}

function toParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 18);
}

function pickExcerpt(text: string, maxLength = 180): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function extractTaskKeywords(task: Task): string[] {
  return `${task.title} ${task.docType} ${task.audience} ${task.scenario}`
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、（）()\[\]{}"'`~\-_/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 18);
}

export function buildEvidenceCards(input: {
  task: Task;
  materials: Material[];
  maxCards?: number;
}): EvidenceCard[] {
  const maxCards = Math.max(1, Math.min(20, input.maxCards ?? 8));
  const keywords = extractTaskKeywords(input.task);

  const candidates: Array<EvidenceCard & { _score: number }> = [];
  for (const material of input.materials) {
    const paragraphs = toParagraphs(material.content).slice(0, 10);
    paragraphs.forEach((paragraph, index) => {
      const normalized = paragraph.toLowerCase();
      let score = index === 0 ? 1.2 : 1;
      let hitCount = 0;
      for (const keyword of keywords) {
        if (normalized.includes(keyword)) {
          hitCount += 1;
        }
      }
      score += hitCount * 0.35;
      if (/数据|风险|措施|结论|影响|计划|进度/.test(normalized)) {
        score += 0.3;
      }

      candidates.push({
        card_id: "",
        material_id: material.id,
        material_title: material.title,
        excerpt: pickExcerpt(paragraph),
        relevance: hitCount > 0 ? `命中${hitCount}个任务关键词` : "结构性参考段落",
        _score: score,
      });
    });
  }

  return candidates
    .sort((a, b) => b._score - a._score)
    .slice(0, maxCards)
    .map((item, index) => ({
      card_id: `E${String(index + 1).padStart(2, "0")}`,
      material_id: item.material_id,
      material_title: item.material_title,
      excerpt: item.excerpt,
      relevance: item.relevance,
    }));
}
