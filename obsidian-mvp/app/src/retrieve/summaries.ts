import type {
  EvidenceCard,
  Material,
  MaterialSummary,
  Task,
  TemplateRewriteHint,
  TemplateRewriteStep,
} from "../types/domain.js";
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

function deriveTemplateSections(content: string, count: number): string[] {
  const candidates = normalizeSummarySource(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+\.)/.test(line))
    .filter((line) => line.length <= 40);
  return [...new Set(candidates)].slice(0, count);
}

function inferSectionIntent(section: string): string {
  if (/概况|背景|总体|情况/.test(section)) {
    return "先交代背景、范围和总体情况";
  }
  if (/采购组|组织|分工|成员/.test(section)) {
    return "交代参与主体、组织方式和责任安排";
  }
  if (/方案建议|建议|措施|安排|计划/.test(section)) {
    return "承接前文事实后，落到方案、建议或下一步动作";
  }
  if (/风险|问题/.test(section)) {
    return "展开风险、问题及影响，为后续措施做铺垫";
  }
  return "作为固定结构段落，需结合本次背景替换旧事实和旧结论";
}

export function summarizeMaterial(material: Material): MaterialSummary {
  const materialRole = detectMaterialRole(material);
  const logicChain = parseSectionBullets(material.content, "逻辑关系", 4);
  const templateSlots = parseSectionBullets(material.content, "模板槽位", 6);
  const sectionIntents = parseSectionBullets(material.content, "段落意图", 6);
  const derivedSections = materialRole === "template" ? deriveTemplateSections(material.content, 6) : [];
  const derivedTemplateSlots =
    materialRole === "template" && !templateSlots.length
      ? derivedSections.map(
          (section) =>
            `${section}；替换规则：保留该段结构与标题，但把旧项目背景、旧数据和旧结论替换为本次任务事实；取材依据：优先使用本次背景材料和任务事实`,
        )
      : [];
  const derivedIntents =
    materialRole === "template" && !sectionIntents.length
      ? derivedSections.map((section) => `${section}；段落意图：${inferSectionIntent(section)}`)
      : [];
  const derivedLogic =
    materialRole === "template" && !logicChain.length && derivedSections.length >= 2
      ? derivedSections.slice(0, -1).map((section, index) => {
          const nextSection = derivedSections[index + 1];
          return `先写「${section}」再写「${nextSection}」；原因：先按模板固定结构铺开，再承接到后续章节`;
        })
      : [];

  return {
    material_id: material.id,
    title: material.title,
    doc_type: material.docType,
    material_role: materialRole,
    structure_summary: takeLines(material.content, 3),
    style_summary: [
      material.quality ? `质量标记：${material.quality}` : "",
      material.audience ? `面向对象：${material.audience}` : "",
      material.scenario ? `场景：${material.scenario}` : "",
    ].filter(Boolean),
    useful_phrases: takeLines(material.content, 2),
    logic_chain: logicChain.length ? logicChain : derivedLogic,
    template_slots: templateSlots.length ? templateSlots : derivedTemplateSlots,
    section_intents: sectionIntents.length ? sectionIntents : derivedIntents,
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

function normalizePieces(input: string[]): string[] {
  return input
    .flatMap((item) => String(item || "").split(/[；;。.!！?\n]/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isFactLikeText(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }
  if (/^-\s*(标题|类型|来源|使用场景|面向对象|质量判断)：/.test(normalized)) {
    return false;
  }
  if (/(标题：|类型：|来源：|使用场景：|面向对象：|质量判断：)/.test(normalized) && normalized.length < 120) {
    return false;
  }
  return true;
}

function scoreFactForStep(input: {
  fact: string;
  section: string;
  intent: string;
  mustInclude: string[];
}): number {
  const text = `${input.section} ${input.intent}`.toLowerCase();
  const fact = input.fact.toLowerCase();
  let score = 0;

  if (/概况|背景|总体|需求|来源/.test(text) && /背景|项目|总体|需求|预算|来源|情况|阶段/.test(fact)) {
    score += 2.2;
  }
  if (/风险|问题|影响/.test(text) && /风险|问题|影响|延迟|不足|隐患|挑战/.test(fact)) {
    score += 2.5;
  }
  if (/安排|计划|建议|措施|下一步|采购方案/.test(text) && /下一步|安排|计划|措施|建议|签署|上线|推进/.test(fact)) {
    score += 2.3;
  }
  if (/采购组|组织|分工|责任/.test(text) && /责任|部门|分工|组织|人员/.test(fact)) {
    score += 2.2;
  }
  if (/采购组|组织|分工|责任/.test(text) && /风险|问题|影响|延迟|隐患/.test(fact)) {
    score -= 1.8;
  }
  if (/采购组|组织|分工|责任/.test(text) && /下一步|安排|计划|签署|上线/.test(fact)) {
    score -= 1.1;
  }
  if (/采购|结果|资金/.test(text) && /采购|金额|供应商|结果|资金|预算/.test(fact)) {
    score += 1.8;
  }

  input.mustInclude.forEach((item) => {
    const keyword = item.trim();
    if (keyword && text.includes(keyword.toLowerCase()) && fact.includes(keyword.toLowerCase())) {
      score += 1.4;
    }
  });

  if (!score) {
    if (fact.includes("项目") || fact.includes("采购")) {
      score += 0.4;
    }
    if (fact.includes("下一步")) {
      score += 0.6;
    }
  }

  return score;
}

function scoreRequirementForStep(input: {
  requirement: string;
  section: string;
  intent: string;
}): number {
  const text = `${input.section} ${input.intent}`.toLowerCase();
  const requirement = input.requirement.toLowerCase();
  let score = 0;

  if (/概况|背景|总体|需求|来源/.test(text) && /背景|总体|概况|需求|来源/.test(requirement)) {
    score += 2.2;
  }
  if (/风险|问题|影响/.test(text) && /风险|问题|影响/.test(requirement)) {
    score += 3;
  }
  if (/安排|计划|建议|措施|下一步|采购方案/.test(text) && /下一步|安排|计划|建议|措施/.test(requirement)) {
    score += 3;
  }
  if (/采购|结果|资金/.test(text) && /采购结果|结果|资金|预算/.test(requirement)) {
    score += 2.8;
  }
  if (/采购组|组织|分工|责任/.test(text) && /分工|责任|组织/.test(requirement)) {
    score += 2.6;
  }
  if (/采购组|组织|分工|责任/.test(text) && /采购结果|结果|风险提示|风险/.test(requirement)) {
    score -= 2.2;
  }
  if (/方案建议|建议|措施|安排|计划/.test(text) && /下一步安排|风险提示/.test(requirement)) {
    score += 1.6;
  }
  if (/概况|背景|总体|情况/.test(text) && /采购结果/.test(requirement)) {
    score += 0.8;
  }
  if (/优化情况/.test(text) && /风险提示/.test(requirement)) {
    score += 1.1;
  }

  return score;
}

function pickRequirementsForStep(input: {
  section: string;
  intent: string;
  mustInclude: string[];
}): string[] {
  return input.mustInclude
    .map((requirement) => ({
      requirement,
      score: scoreRequirementForStep({
        requirement,
        section: input.section,
        intent: input.intent,
      }),
    }))
    .filter((item) => item.score > 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.requirement);
}

function pickFactsForStep(input: {
  section: string;
  intent: string;
  rawFacts: string[];
  mustInclude: string[];
  evidenceCards: EvidenceCard[];
}): string[] {
  const candidateFacts = [
    ...normalizePieces(input.rawFacts),
    ...normalizePieces(input.mustInclude),
    ...input.evidenceCards
      .slice(0, 3)
      .map((card) => card.excerpt)
      .filter(isFactLikeText),
  ];

  return candidateFacts
    .map((fact) => ({
      fact,
      score: scoreFactForStep({
        fact,
        section: input.section,
        intent: input.intent,
        mustInclude: input.mustInclude,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((item, index, list) => item.score > 0 && list.findIndex((entry) => entry.fact === item.fact) === index)
    .slice(0, 3)
    .map((item) => item.fact);
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
  const facts = input.taskAnalysis.raw_facts.slice(0, 3).join("；") || "优先从本次背景材料中提取";
  const mustIncludeItems = input.taskAnalysis.must_include.slice(0, 4);
  const mustInclude = mustIncludeItems.join("；");
  const evidenceCards = input.evidenceCards.slice(0, 3);
  const evidenceIds = evidenceCards.map((card) => card.card_id);
  const evidence = evidenceCards.map((card) => `${card.material_title}#${card.card_id}`).join("、");
  const logicChain = summary.logic_chain.slice(0, 8);
  const rewriteSteps: TemplateRewriteStep[] = summary.template_slots.slice(0, 6).map((slot, index) => {
    const section = slot.split("；")[0]?.trim() || `段落${index + 1}`;
    const intent =
      summary.section_intents.find((item) => item.includes(section)) ||
      summary.section_intents[index] ||
      "沿用模板段落功能，但改写为本次任务语境";
    const logicAfter = index > 0 ? logicChain[index - 1] || logicChain[0] || null : null;
    const assignedFacts = pickFactsForStep({
      section,
      intent,
      rawFacts: input.taskAnalysis.raw_facts,
      mustInclude: mustIncludeItems,
      evidenceCards,
    });
    const assignedRequirements = pickRequirementsForStep({
      section,
      intent,
      mustInclude: mustIncludeItems,
    });
    return {
      section,
      slot_name: slot,
      intent,
      assigned_facts: assignedFacts,
      assigned_requirements: assignedRequirements,
      fill_strategy: `优先填入「${assignedFacts.join("；") || facts}」${
        assignedRequirements.length
          ? `；本段重点覆盖「${assignedRequirements.join("；")}」`
          : mustInclude
            ? `；并确保覆盖「${mustInclude}」`
            : ""
      }`,
      source_hint: evidence || "优先使用本次背景材料与任务事实",
      evidence_card_ids: evidenceIds,
      logic_after: logicAfter,
    };
  });

  const plan = rewriteSteps.map((step) => {
    return `按槽位改写：${step.slot_name}；本次优先填入「${facts}」${mustInclude ? `；并确保覆盖「${mustInclude}」` : ""}${step.intent ? `；段落意图参考「${step.intent}」` : ""}${step.source_hint ? `；证据优先来自 ${step.source_hint}` : ""}${step.logic_after ? `；并放在「${step.logic_after}」之后` : ""}`;
  });

  if (!plan.length) {
    rewriteSteps.push({
      section: "整体结构",
      slot_name: "沿用模板整体结构",
      intent: "保持模板的整体段落顺序和表达功能",
      assigned_facts: normalizePieces(input.taskAnalysis.raw_facts).slice(0, 3),
      assigned_requirements: mustIncludeItems,
      fill_strategy: `将旧背景、旧事实和旧结论替换为本次任务事实：${facts || "待从背景材料中抽取"}`,
      source_hint: evidence || "优先使用本次背景材料与任务事实",
      evidence_card_ids: evidenceIds,
      logic_after: logicChain[0] || null,
    });
    plan.push(
      `优先沿用模板《${input.selectedTemplate.title}》的整体结构，但将其中旧背景、旧事实和旧结论替换为本次任务事实：${facts || "待从背景材料中抽取"}`,
    );
  }

  summary.logic_chain.slice(0, 3).forEach((item) => {
    plan.push(`逻辑顺序约束：${item}`);
  });

  return {
    template_title: input.selectedTemplate.title,
    rewrite_steps: rewriteSteps.slice(0, 8),
    rewrite_plan: plan.slice(0, 8),
  };
}
