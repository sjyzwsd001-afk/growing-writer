import type {
  EvidenceCard,
  LogicChainItem,
  Material,
  MaterialSummary,
  SectionIntentSummary,
  Task,
  TemplateSlotSummary,
  TemplateRewriteHint,
  TemplateRewriteStep,
} from "../types/domain.js";
import type { TaskAnalysis } from "../types/schemas.js";
import { tokenizeForMatch } from "./text-utils.js";

const LOW_ASSIGNMENT_CONFIDENCE_THRESHOLD = 0.28;
const FACT_SCORE_WEIGHTS = {
  semantic: 2.8,
  overlap: 1.5,
  intent: 1.1,
  evidence: 0.6,
  numeric: 0.2,
} as const;
const FACT_SELECTION_MAX_SCORE =
  FACT_SCORE_WEIGHTS.semantic +
  FACT_SCORE_WEIGHTS.overlap +
  FACT_SCORE_WEIGHTS.intent +
  FACT_SCORE_WEIGHTS.evidence +
  FACT_SCORE_WEIGHTS.numeric;

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

function parseLogicChainItems(content: string, count: number): LogicChainItem[] {
  return parseSectionBullets(content, "逻辑关系", count)
    .map((line) => {
      const normalized = line.replace(/^逻辑\d+：/, "").trim();
      const match = normalized.match(/^先写「(.+?)」再写「(.+?)」；原因：(.+)$/);
      if (!match) {
        return null;
      }
      return {
        from: match[1].trim(),
        to: match[2].trim(),
        reason: match[3].trim(),
      } satisfies LogicChainItem;
    })
    .filter((item): item is LogicChainItem => Boolean(item));
}

function parseTemplateSlotItems(content: string, count: number): TemplateSlotSummary[] {
  return parseSectionBullets(content, "模板槽位", count)
    .map((line) => {
      const normalized = line.replace(/^槽位\d+：/, "").trim();
      const match = normalized.match(/^(.+?)\s*\/\s*(.+?)；替换规则：(.+?)；取材依据：(.+)$/);
      if (!match) {
        return null;
      }
      return {
        section: match[1].trim(),
        slot_name: match[2].trim(),
        fill_rule: match[3].trim(),
        source_hint: match[4].trim(),
      } satisfies TemplateSlotSummary;
    })
    .filter((item): item is TemplateSlotSummary => Boolean(item));
}

function parseSectionIntentItems(content: string, count: number): SectionIntentSummary[] {
  return parseSectionBullets(content, "段落意图", count)
    .map((line) => {
      const normalized = line.replace(/^意图\d+：/, "").trim();
      const match = normalized.match(/^(.+?)；写作意图：(.+?)；触发条件：(.+)$/);
      if (!match) {
        return null;
      }
      return {
        section: match[1].trim(),
        intent: match[2].trim(),
        trigger: match[3].trim(),
      } satisfies SectionIntentSummary;
    })
    .filter((item): item is SectionIntentSummary => Boolean(item));
}

function parseFrontmatterLogicChain(value: unknown): LogicChainItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.from !== "string" ||
        typeof entry.to !== "string" ||
        typeof entry.reason !== "string"
      ) {
        return null;
      }
      return {
        from: entry.from.trim(),
        to: entry.to.trim(),
        reason: entry.reason.trim(),
      } satisfies LogicChainItem;
    })
    .filter((item): item is LogicChainItem => Boolean(item));
}

function parseFrontmatterTemplateSlots(value: unknown): TemplateSlotSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.section !== "string" ||
        typeof entry.slot_name !== "string" ||
        typeof entry.fill_rule !== "string" ||
        typeof entry.source_hint !== "string"
      ) {
        return null;
      }
      return {
        section: entry.section.trim(),
        slot_name: entry.slot_name.trim(),
        fill_rule: entry.fill_rule.trim(),
        source_hint: entry.source_hint.trim(),
      } satisfies TemplateSlotSummary;
    })
    .filter((item): item is TemplateSlotSummary => Boolean(item));
}

function parseFrontmatterSectionIntents(value: unknown): SectionIntentSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.section !== "string" ||
        typeof entry.intent !== "string" ||
        typeof entry.trigger !== "string"
      ) {
        return null;
      }
      return {
        section: entry.section.trim(),
        intent: entry.intent.trim(),
        trigger: entry.trigger.trim(),
      } satisfies SectionIntentSummary;
    })
    .filter((item): item is SectionIntentSummary => Boolean(item));
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
    .filter((line) =>
      /^(?:(?:[一二三四五六七八九十百]+、)|(?:（[一二三四五六七八九十百]+）)|(?:【[一二三四五六七八九十百]+】)|(?:第[一二三四五六七八九十百]+[章节部分条点项])|(?:\(\d+\))|(?:（\d+）)|(?:\d+[.、]))/.test(
        line,
      ),
    )
    .filter((line) => line.length <= 40);
  return [...new Set(candidates)].slice(0, count);
}

function extractStructuredSectionsFromContent(
  content: string,
): Array<{ heading: string; normalized: string; body: string }> {
  const lines = normalizeSummarySource(content).split(/\r?\n/);
  const sections: Array<{ heading: string; normalized: string; body: string }> = [];
  const headingPattern =
    /^(?:(?:[一二三四五六七八九十百]+、)|(?:（[一二三四五六七八九十百]+）)|(?:【[一二三四五六七八九十百]+】)|(?:第[一二三四五六七八九十百]+[章节部分条点项])|(?:\(\d+\))|(?:（\d+）)|(?:\d+[.、]))/u;
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (headingPattern.test(line) && line.length <= 60) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          normalized: normalizeStructureLabel(currentHeading),
          body: currentBody.join(" ").replace(/\s+/g, " ").trim(),
        });
      }
      currentHeading = line;
      currentBody = [];
      continue;
    }
    if (currentHeading) {
      currentBody.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      normalized: normalizeStructureLabel(currentHeading),
      body: currentBody.join(" ").replace(/\s+/g, " ").trim(),
    });
  }

  return sections;
}

function pickSectionExcerpt(
  sections: Array<{ heading: string; normalized: string; body: string }>,
  target: string,
): string {
  const normalizedTarget = normalizeStructureLabel(target);
  if (!normalizedTarget) {
    return "";
  }
  const exact = sections.find((item) => item.normalized === normalizedTarget);
  if (exact?.body) {
    return pickExcerpt(exact.body, 220);
  }
  const fuzzy = sections.find(
    (item) =>
      item.normalized.includes(normalizedTarget) || normalizedTarget.includes(item.normalized),
  );
  return fuzzy?.body ? pickExcerpt(fuzzy.body, 220) : "";
}

function inferWritingPattern(excerpt: string): string {
  const text = String(excerpt || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  const hints: string[] = [];
  const sentences = text
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const firstSentence = sentences[0] || text;
  const lastSentence = sentences[sentences.length - 1] || text;
  if (/^(首先|一是|一方面|为进一步|为贯彻|根据|围绕)/.test(text)) {
    hints.push("开头直接交代依据或切入点");
  } else if (/^(项目|本次|当前|针对|关于)/.test(text)) {
    hints.push("开头先点明对象或当前事项");
  }
  if (/^(经|根据|按照|围绕|结合|为|针对)/.test(firstSentence)) {
    hints.push("常先交代依据或判断前提，再展开正文");
  }
  if (/^(目前|当前|现阶段|从现有情况看|经梳理)/.test(firstSentence)) {
    hints.push("常先交代现状或事实背景，再进入分析");
  }
  if (/\d|%|万元|亿元|家|项|天|月|年/.test(text)) {
    hints.push("正文里常夹带数据或量化事实");
  }
  if (/因此|同时|另一方面|下一步|此外|其中|在此基础上/.test(text)) {
    hints.push("段内会用承接词推进逻辑");
  }
  if (/问题|风险|不足|短板/.test(text) && /建议|措施|改进|完善|推进|落实/.test(text)) {
    hints.push("常按问题或风险在前、措施和动作在后展开");
  }
  if (/情况|进展|成效|结果/.test(firstSentence) && /建议|判断|下一步|安排/.test(lastSentence)) {
    hints.push("常先铺事实或进展，再收束到判断和安排");
  }
  if (/认为|总体看|综合研判|建议/.test(lastSentence)) {
    hints.push("结尾会收束成判断、结论或明确建议");
  }
  if (/一是|二是|三是|首先|其次|再次/.test(text)) {
    hints.push("常按分点并列方式展开论证");
  }
  if (/建议|应当|需|将|推进|落实|完善/.test(text)) {
    hints.push("结尾常落到建议、安排或动作");
  }
  if (/，/.test(text) && text.length > 80) {
    hints.push("句式偏长，倾向先铺事实再收束判断");
  } else {
    hints.push("句式偏短，适合直接落结论");
  }
  return [...new Set(hints)].slice(0, 3).join("；");
}

function inferSectionIntentInfo(section: string): { label: string; description: string } {
  const text = `${section}`;
  if (/概况|背景|总体|情况|现状|目标|缘由|依据|范围|说明|综述/.test(text)) {
    return {
      label: "background",
      description: "先交代背景、范围和总体情况",
    };
  }
  if (/组织|分工|成员|职责|责任|机制|协同|专班|小组/.test(text)) {
    return {
      label: "organization",
      description: "交代参与主体、组织方式和责任安排",
    };
  }
  if (/方案|建议|措施|安排|计划|路径|抓手|动作|落实/.test(text)) {
    return {
      label: "action",
      description: "承接前文事实后，落到方案、建议或下一步动作",
    };
  }
  if (/风险|问题|挑战|难点|短板|隐患|影响/.test(text)) {
    return {
      label: "risk",
      description: "展开风险、问题及影响，为后续措施做铺垫",
    };
  }
  if (/结果|成效|成果|产出|数据|指标|进展/.test(text)) {
    return {
      label: "result",
      description: "集中呈现关键结果、进展或量化成效，作为后续判断基础",
    };
  }
  if (/结论|收尾|总结|建议事项|下一步/.test(text)) {
    return {
      label: "conclusion",
      description: "在主体事实之后收束判断，并明确后续安排或决策建议",
    };
  }
  return {
    label: "generic",
    description: "作为固定结构段落，需结合本次背景替换旧事实和旧结论",
  };
}

function inferSectionIntent(section: string): string {
  return inferSectionIntentInfo(section).description;
}

function inferSectionIntentLabel(section: string): string {
  return inferSectionIntentInfo(section).label;
}

export function summarizeMaterial(material: Material): MaterialSummary {
  const materialRole = detectMaterialRole(material);
  const frontmatterLogicChain = parseFrontmatterLogicChain(material.frontmatter.logic_chain);
  const frontmatterTemplateSlots = parseFrontmatterTemplateSlots(material.frontmatter.template_slots);
  const frontmatterSectionIntents = parseFrontmatterSectionIntents(material.frontmatter.section_intents);
  const logicChain = frontmatterLogicChain.length
    ? frontmatterLogicChain
    : parseLogicChainItems(material.content, 6);
  const templateSlots = frontmatterTemplateSlots.length
    ? frontmatterTemplateSlots
    : parseTemplateSlotItems(material.content, 8);
  const sectionIntents = frontmatterSectionIntents.length
    ? frontmatterSectionIntents
    : parseSectionIntentItems(material.content, 8);
  const derivedSections = deriveTemplateSections(material.content, 6);
  const derivedTemplateSlots =
    materialRole === "template" && !templateSlots.length
      ? derivedSections.map(
          (section) =>
            ({
              section,
              slot_name: "沿用该段标题与结构",
              fill_rule: "保留该段结构与标题，但把旧背景、旧数据和旧结论替换为本次任务事实。",
              source_hint: "优先使用本次背景材料、任务事实和命中的历史材料证据。",
            }) satisfies TemplateSlotSummary,
        )
      : [];
  const derivedIntents =
    materialRole === "template" && derivedSections.length && !sectionIntents.length
      ? derivedSections.map(
          (section) =>
            ({
              section,
              intent: inferSectionIntent(section),
              trigger: "当本次任务仍沿用这一固定段落功能时触发",
            }) satisfies SectionIntentSummary,
        )
      : [];
  const derivedLogic =
    materialRole === "template" && !logicChain.length && derivedSections.length >= 2
      ? derivedSections.slice(0, -1).map((section, index) => {
          const nextSection = derivedSections[index + 1];
          return {
            from: section,
            to: nextSection,
            reason: "先按模板固定结构铺开，再承接到后续章节。",
          } satisfies LogicChainItem;
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

export function normalizeStructureLabel(text: string): string {
  return String(text || "")
    .replace(/^[\s#-]+/, "")
    .replace(
      /^(?:(?:[一二三四五六七八九十百]+、)|(?:（[一二三四五六七八九十百]+）)|(?:【[一二三四五六七八九十百]+】)|(?:第[一二三四五六七八九十百]+[章节部分条点项])|(?:\(\d+\))|(?:（\d+）)|(?:\d+[.、]))\s*/u,
      "",
    )
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function scoreStructureMatch(left: string, right: string): number {
  const normalizedLeft = normalizeStructureLabel(left);
  const normalizedRight = normalizeStructureLabel(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 4;
  }
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 2.4;
  }

  const chunks = [normalizedLeft, normalizedRight];
  const overlap = chunks[0]
    .split(/(?=[\u4e00-\u9fff])/)
    .filter((item) => item && item.length >= 1)
    .filter((token) => chunks[1].includes(token)).length;
  return overlap * 0.4;
}

function collectStructureSections(summary: MaterialSummary): string[] {
  const sections = [
    ...summary.template_slots.map((item) => item.section),
    ...summary.section_intents.map((item) => item.section),
    ...summary.logic_chain.flatMap((item) => [item.from, item.to]),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return [...new Set(sections)];
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
  const semanticBuckets: Array<{ intent: RegExp; fact: RegExp; hit: number; miss?: number }> = [
    {
      intent: /概况|背景|总体|情况|现状|目标|缘由|依据|范围|需求|来源/,
      fact: /背景|现状|总体|目标|缘由|依据|范围|需求|来源|情况|阶段|项目|任务/,
      hit: 2.2,
    },
    {
      intent: /风险|问题|挑战|影响|难点|短板|隐患/,
      fact: /风险|问题|挑战|影响|难点|短板|隐患|延迟|不足|波动/,
      hit: 2.5,
    },
    {
      intent: /措施|建议|安排|计划|下一步|路径|方案|动作|抓手/,
      fact: /措施|建议|安排|计划|下一步|路径|方案|动作|推进|落实|优化|整改/,
      hit: 2.3,
    },
    {
      intent: /组织|分工|职责|责任|机制|成员|协同|专班|小组/,
      fact: /组织|分工|职责|责任|机制|成员|协同|专班|小组|部门|牵头/,
      hit: 2.2,
      miss: -1.4,
    },
    {
      intent: /结果|成效|产出|金额|预算|资金|指标|数据/,
      fact: /结果|成效|产出|金额|预算|资金|指标|数据|供应商|数量|比例/,
      hit: 1.8,
    },
  ];

  semanticBuckets.forEach((bucket) => {
    if (!bucket.intent.test(text)) {
      return;
    }
    if (bucket.fact.test(fact)) {
      score += bucket.hit;
    } else if (typeof bucket.miss === "number") {
      score += bucket.miss;
    }
  });

  input.mustInclude.forEach((item) => {
    const keyword = item.trim();
    if (!keyword) {
      return;
    }
    const normalizedKeyword = keyword.toLowerCase();
    if (text.includes(normalizedKeyword) && fact.includes(normalizedKeyword)) {
      score += 1.6;
    } else if (fact.includes(normalizedKeyword)) {
      score += 0.9;
    }
  });

  if (!score) {
    if (/项目|任务|背景|情况|安排|建议|风险|结果/.test(fact)) {
      score += 0.4;
    }
    if (/下一步|安排|计划/.test(fact)) {
      score += 0.6;
    }
  }

  return score;
}

function scoreSemanticKeywordOverlap(input: {
  fact: string;
  section: string;
  intent: string;
  mustInclude: string[];
}): number {
  const factTokens = tokenizeForMatch(input.fact);
  const stepTokens = tokenizeForMatch(
    `${input.section} ${input.intent} ${input.mustInclude.join(" ")}`,
  );
  if (!factTokens.length || !stepTokens.length) {
    return 0;
  }
  const overlap = factTokens.filter((token) =>
    stepTokens.some((stepToken) => stepToken.includes(token) || token.includes(stepToken)),
  );
  return Math.min(2.2, overlap.length * 0.55);
}

function scoreIntentBucket(section: string, intent: string, fact: string): number {
  const bucket = inferSectionIntentLabel(`${section} ${intent}`);
  if (bucket === "generic") {
    return 0;
  }
  const mapping: Record<string, RegExp> = {
    background: /背景|现状|总体|目标|缘由|依据|范围|需求|来源|阶段|项目|任务/,
    organization: /组织|分工|职责|责任|机制|成员|协同|专班|小组|部门|牵头/,
    action: /措施|建议|安排|计划|下一步|路径|方案|动作|推进|落实|优化|整改/,
    risk: /风险|问题|挑战|影响|难点|短板|隐患|延迟|不足|波动/,
    result: /结果|成效|成果|产出|数据|指标|进展|金额|预算|资金|数量|比例/,
    conclusion: /结论|总结|建议|安排|下一步|决定|判断/,
  };
  return mapping[bucket]?.test(fact.toLowerCase()) ? 1.8 : 0;
}

function scoreFactForStepV2(input: {
  fact: string;
  section: string;
  intent: string;
  mustInclude: string[];
  evidenceCards: EvidenceCard[];
}): number {
  const fact = input.fact.trim();
  const semanticScore = scoreFactForStep(input);
  const overlapScore = scoreSemanticKeywordOverlap(input);
  const intentScore = scoreIntentBucket(input.section, input.intent, fact);

  const factLower = fact.toLowerCase();
  const evidenceHit = input.evidenceCards.some((card) =>
    factLower.includes(card.excerpt.toLowerCase().slice(0, 18)) ||
    card.excerpt.toLowerCase().includes(factLower.slice(0, 18)),
  );
  const evidenceScore = evidenceHit ? 1 : 0;
  const numericSignal = /^\d+[%万千百]?|预算|金额|数量|指标|进度|节点|合同|供应商|交付/.test(fact) ? 1 : 0;

  // Weighted combination:
  // - semantic buckets carry the strongest prior about "this fact belongs in this section"
  // - token overlap refines local wording match
  // - intent bucket is a lighter tie-breaker
  // - evidence / numeric signals only nudge confidence upward
  return (
    Math.min(1, semanticScore / 3.2) * FACT_SCORE_WEIGHTS.semantic +
    Math.min(1, overlapScore / 2.2) * FACT_SCORE_WEIGHTS.overlap +
    Math.min(1, intentScore / 1.8) * FACT_SCORE_WEIGHTS.intent +
    evidenceScore * FACT_SCORE_WEIGHTS.evidence +
    numericSignal * FACT_SCORE_WEIGHTS.numeric
  );
}

function scoreRequirementForStep(input: {
  requirement: string;
  section: string;
  intent: string;
}): number {
  const text = `${input.section} ${input.intent}`.toLowerCase();
  const requirement = input.requirement.toLowerCase();
  let score = 0;

  const requirementBuckets: Array<{ intent: RegExp; requirement: RegExp; hit: number; miss?: number }> = [
    {
      intent: /概况|背景|总体|情况|现状|目标|需求|来源/,
      requirement: /背景|总体|概况|现状|目标|需求|来源/,
      hit: 2.2,
    },
    {
      intent: /风险|问题|影响|挑战|难点|隐患/,
      requirement: /风险|问题|影响|挑战|难点|隐患/,
      hit: 3,
    },
    {
      intent: /安排|计划|建议|措施|下一步|方案|动作/,
      requirement: /下一步|安排|计划|建议|措施|方案|动作/,
      hit: 3,
    },
    {
      intent: /结果|成效|产出|资金|预算|指标|数据/,
      requirement: /结果|成效|产出|资金|预算|指标|数据/,
      hit: 2.8,
    },
    {
      intent: /组织|分工|职责|责任|机制|成员/,
      requirement: /组织|分工|职责|责任|机制|成员/,
      hit: 2.6,
      miss: -2.2,
    },
  ];

  requirementBuckets.forEach((bucket) => {
    if (!bucket.intent.test(text)) {
      return;
    }
    if (bucket.requirement.test(requirement)) {
      score += bucket.hit;
    } else if (typeof bucket.miss === "number") {
      score += bucket.miss;
    }
  });

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
}): { facts: string[]; confidence: number } {
  const candidateFacts = [
    ...normalizePieces(input.rawFacts),
    ...normalizePieces(input.mustInclude),
    ...input.evidenceCards
      .slice(0, 5)
      .map((card) => card.excerpt)
      .filter(isFactLikeText),
  ];

  const scored = candidateFacts
    .map((fact) => ({
      fact,
      score: scoreFactForStepV2({
        fact,
        section: input.section,
        intent: input.intent,
        mustInclude: input.mustInclude,
        evidenceCards: input.evidenceCards,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((item, index, list) => item.score > 0 && list.findIndex((entry) => entry.fact === item.fact) === index);

  const top = scored.slice(0, 3);
  const confidence = top.length
    ? Math.max(
        0,
        Math.min(
          1,
          top.reduce((sum, item) => sum + item.score, 0) / (top.length * FACT_SELECTION_MAX_SCORE),
        ),
      )
    : 0;

  return {
    facts: top.map((item) => item.fact),
    confidence,
  };
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
  referenceMaterials?: Material[];
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
  const templateSections = extractStructuredSectionsFromContent(input.selectedTemplate.content);
  const derivedSections = deriveTemplateSections(input.selectedTemplate.content, 6);
  const historySummaries = (input.referenceMaterials ?? [])
    .filter((material) => material.id !== input.selectedTemplate?.id)
    .map((material) => ({
      summary: summarizeMaterial(material),
      sections: extractStructuredSectionsFromContent(material.content),
    }))
    .filter((item) => item.summary.material_role !== "template");
  const historyLogicChain = historySummaries.flatMap((item) => item.summary.logic_chain).slice(0, 8);
  const historySectionHints = historySummaries
    .flatMap((item) =>
      collectStructureSections(item.summary).map((section) => ({
        title: item.summary.title,
        section,
        normalized_section: normalizeStructureLabel(section),
        excerpt: pickSectionExcerpt(item.sections, section),
        writing_pattern: inferWritingPattern(pickSectionExcerpt(item.sections, section)),
      })),
    )
    .slice(0, 12);
  const effectiveSlots =
    summary.template_slots.length
      ? summary.template_slots.slice(0, 6)
      : derivedSections.slice(0, 6).map(
          (section: string, index: number) =>
            ({
              section,
              slot_name: section || `派生段落${index + 1}`,
              fill_rule: "保留段落职责，按本次任务背景与事实重写本段。",
              source_hint: "优先引用本次背景材料、任务事实与对应证据卡。",
            }) satisfies TemplateSlotSummary,
        );
  const warnings: string[] = [];
  let fallbackMode: TemplateRewriteHint["fallback_mode"] = "structured";
  if (!summary.template_slots.length) {
    fallbackMode = effectiveSlots.length ? "derived-sections" : "generic-outline";
    warnings.push(
      effectiveSlots.length
        ? "当前模板缺少已分析槽位，系统已改为按派生章节进行段落级改写。"
        : "当前模板未识别出稳定章节结构，系统只能按通用骨架生成，结构约束会明显变弱。",
    );
  }

  const rewriteSteps: TemplateRewriteStep[] = effectiveSlots.map((slot: TemplateSlotSummary, index: number) => {
    const section = slot.section?.trim() || `段落${index + 1}`;
    const intent =
      summary.section_intents.find((item) => item.section === section)?.intent ||
      summary.section_intents[index]?.intent ||
      "沿用模板段落功能，但改写为本次任务语境";
    const matchedHistoryLogic = historyLogicChain
      .map((item) => ({
        item,
        score:
          Math.max(scoreStructureMatch(item.to, section), scoreStructureMatch(item.from, section)) +
          Math.max(scoreStructureMatch(item.to, intent), scoreStructureMatch(item.from, intent)),
      }))
      .filter((entry) => entry.score >= 2)
      .sort((left, right) => right.score - left.score)[0]?.item ?? null;
    const matchedHistorySections = historySectionHints
      .map((item) => ({
        ...item,
        score: scoreStructureMatch(item.section, section) + scoreStructureMatch(item.section, intent),
      }))
      .filter((entry) => entry.score >= 2)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    const logicAfter =
      (index > 0 ? logicChain[index - 1] || logicChain[0] || null : null) ||
      matchedHistoryLogic;
    const factSelection = pickFactsForStep({
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
    const assignedFacts = factSelection.facts;
    const templateExcerpt = pickSectionExcerpt(templateSections, section);
    const templatePattern = inferWritingPattern(templateExcerpt);
    const matchedHistoryHints = matchedHistorySections.map((item) => ({
      material_title: item.title,
      section: item.section,
      normalized_section: item.normalized_section,
      excerpt: item.excerpt,
      writing_pattern: item.writing_pattern,
    }));
    const contentHintWarnings: string[] = [];
    if (!templateExcerpt) {
      contentHintWarnings.push(`模板段落「${section}」未提取到正文参考，只能按结构和事实保守改写。`);
    }
    if (matchedHistoryHints.length > 0 && matchedHistoryHints.every((item) => !item.excerpt)) {
      contentHintWarnings.push(`历史材料对「${section}」只匹配到标题，未提取到正文参考。`);
    }
    if (factSelection.confidence < LOW_ASSIGNMENT_CONFIDENCE_THRESHOLD) {
      warnings.push(`段落「${section}」当前事实匹配置信度偏低，建议补充更直接的背景事实或模板说明。`);
    }
    warnings.push(...contentHintWarnings);
    return {
      section,
      slot_name: slot.slot_name || `${section}对应内容`,
      intent,
      assigned_facts: assignedFacts,
      assigned_requirements: assignedRequirements,
      assignment_confidence: factSelection.confidence,
      template_section_excerpt: templateExcerpt,
      template_writing_pattern: templatePattern,
      content_hint_warning: contentHintWarnings[0] || "",
      history_section_hints: matchedHistoryHints,
      fill_strategy: `优先填入「${assignedFacts.join("；") || facts}」${
        assignedRequirements.length
          ? `；本段重点覆盖「${assignedRequirements.join("；")}」`
          : mustInclude
            ? `；并确保覆盖「${mustInclude}」`
            : ""
      }；替换规则：${slot.fill_rule || "保留段落结构，替换旧事实和旧结论"}`,
      source_hint:
        slot.source_hint ||
        matchedHistorySections
          .map((item) => `${item.title}:${item.section}`)
          .slice(0, 2)
          .join("、") ||
        evidence ||
        "优先使用本次背景材料与任务事实",
      evidence_card_ids: evidenceIds,
      logic_after: logicAfter,
    };
  });

  const plan = rewriteSteps.map((step) => {
    return `按槽位改写：${step.slot_name}；本次优先填入「${facts}」${mustInclude ? `；并确保覆盖「${mustInclude}」` : ""}${step.intent ? `；段落意图参考「${step.intent}」` : ""}${step.source_hint ? `；证据优先来自 ${step.source_hint}` : ""}${step.logic_after ? `；逻辑承接：from=${step.logic_after.from}；to=${step.logic_after.to}；reason=${step.logic_after.reason}` : ""}`;
  });

  if (!plan.length) {
    const genericSections = ["背景与现状", "主体事项", "结论与安排"];
    genericSections.forEach((section, index) => {
      const intent = inferSectionIntent(section);
      const factSelection = pickFactsForStep({
        section,
        intent,
        rawFacts: input.taskAnalysis.raw_facts,
        mustInclude: mustIncludeItems,
        evidenceCards,
      });
      const requirements = pickRequirementsForStep({
        section,
        intent,
        mustInclude: mustIncludeItems,
      });
      rewriteSteps.push({
        section,
        slot_name: `${section}（通用兜底）`,
        intent,
        assigned_facts: factSelection.facts,
        assigned_requirements: requirements,
        assignment_confidence: factSelection.confidence,
        fill_strategy: `按通用写作顺序重建本段，并优先填入「${factSelection.facts.join("；") || facts || "待补充事实"}」`,
        source_hint: evidence || "优先使用本次背景材料与任务事实",
        evidence_card_ids: evidenceIds,
        logic_after: index > 0 ? { from: genericSections[index - 1], to: section, reason: "按默认背景-主体-结论顺序组织" } : null,
      });
    });
    fallbackMode = "generic-outline";
    warnings.push("当前模板完全缺少稳定槽位与章节结构，系统已切到三段式通用骨架生成。");
    plan.push(`当前模板结构缺失，已切换为“背景与现状 -> 主体事项 -> 结论与安排”的通用骨架写作。`);
  }

  summary.logic_chain.slice(0, 3).forEach((item) => {
    plan.push(`逻辑顺序约束：先写「${item.from}」再写「${item.to}」；原因：${item.reason}`);
  });
  historyLogicChain.slice(0, 2).forEach((item) => {
    plan.push(`历史材料逻辑参考：先写「${item.from}」再写「${item.to}」；原因：${item.reason}`);
  });
  historySectionHints.slice(0, 2).forEach((item) => {
    plan.push(`历史材料结构参考：${item.title} 中存在段落「${item.section}」可作为补充结构线索`);
  });

  return {
    template_title: input.selectedTemplate.title,
    fallback_mode: fallbackMode,
    warnings: [...new Set(warnings)].slice(0, 6),
    rewrite_steps: rewriteSteps.slice(0, 8),
    rewrite_plan: plan.slice(0, 8),
  };
}
