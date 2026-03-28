import type { EvidenceCard, Material, MaterialSummary, Task, TemplateRewriteHint } from "../types/domain.js";
import type { TaskAnalysis } from "../types/schemas.js";

function normalizeSummarySource(content: string): string {
  const rawContentSection = content.match(/# 原文内容\s*\n+([\s\S]*?)(?=\n# |\Z)/)?.[1]?.trim();
  if (rawContentSection) {
    return rawContentSection;
  }
  return content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#\s+文档信息[\s\S]*?(?=^#\s+|\Z)/m, "")
    .trim();
}

function shouldIgnoreSummaryLine(line: string): boolean {
  return (
    !line ||
    /^#\s+文档信息/.test(line) ||
    /^-\s*(标题|类型|来源|质量|标签|面向对象|场景)：/.test(line) ||
    /待补充|待人工确认/.test(line)
  );
}

function takeLines(content: string, count: number): string[] {
  return normalizeSummarySource(content)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !shouldIgnoreSummaryLine(line))
    .slice(0, count);
}

function parseSectionBullets(content: string, heading: string, count: number): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^#\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^#\\s+|\\Z)`, "m"));
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .slice(0, count);
}

function detectMaterialRole(material: Material): "template" | "history" | "unknown" {
  const source = String(material.frontmatter.source || "");
  if (material.tags.some((tag) => /template|模板/i.test(tag)) || /template|模板/i.test(source)) {
    return "template";
  }
  if (material.title || material.docType) {
    return "history";
  }
  return "unknown";
}

export function summarizeMaterial(material: Material): MaterialSummary {
  return {
    material_id: material.id,
    title: material.title,
    doc_type: material.docType,
    material_role: detectMaterialRole(material),
    structure_summary: takeLines(material.content, 3),
    style_summary: [
      material.quality ? `质量标记：${material.quality}` : "",
      material.audience ? `面向对象：${material.audience}` : "",
      material.scenario ? `场景：${material.scenario}` : "",
    ].filter(Boolean),
    useful_phrases: takeLines(material.content, 2),
    logic_chain: parseSectionBullets(material.content, "逻辑关系", 4),
    template_slots: parseSectionBullets(material.content, "模板槽位", 6),
    section_intents: parseSectionBullets(material.content, "段落意图", 6),
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

export function buildTemplateRewriteHint(input: {
  selectedTemplate: Material | null;
  task: Task;
  taskAnalysis: TaskAnalysis;
  evidenceCards: EvidenceCard[];
}): TemplateRewriteHint | null {
  if (!input.selectedTemplate) {
    return null;
  }

  const summary = summarizeMaterial(input.selectedTemplate);
  const evidence = input.evidenceCards
    .slice(0, 3)
    .map((card) => `${card.material_title}#${card.card_id}`)
    .join("、");
  const facts = input.taskAnalysis.raw_facts.slice(0, 3).join("；") || "优先从本次背景材料中提取";
  const mustInclude = input.taskAnalysis.must_include.slice(0, 4).join("；");
  const plan = summary.template_slots.slice(0, 6).map((slot) => {
    const intent = summary.section_intents.find((item) => item.includes(slot.split("；")[0] || ""));
    return `按槽位改写：${slot}；本次优先填入「${facts}」${mustInclude ? `；并确保覆盖「${mustInclude}」` : ""}${intent ? `；段落意图参考「${intent}」` : ""}${evidence ? `；证据优先来自 ${evidence}` : ""}`;
  });

  if (!plan.length) {
    plan.push(
      `优先沿用模板《${input.selectedTemplate.title}》的整体结构，但将其中旧背景、旧事实和旧结论替换为本次任务事实：${facts || "待从背景材料中抽取"}`,
    );
  }

  summary.logic_chain.slice(0, 3).forEach((item) => {
    plan.push(`逻辑顺序约束：${item}`);
  });

  return {
    template_title: input.selectedTemplate.title,
    rewrite_plan: plan.slice(0, 8),
  };
}
