import type { Feedback, MaterialSummary, Rule } from "./domain.js";
import type { TaskAnalysis } from "./schemas.js";

export type NormalizedTaskAnalysis = {
  taskType: string;
  audience: string;
  scenario: string;
  goal: string;
  mustInclude: string[];
  constraints: string[];
  rawFacts: string[];
  missingInfo: string[];
  riskFlags: string[];
  confidence: number;
};

export type NormalizedMaterialSummary = {
  materialId: string;
  title: string;
  docType: string;
  materialRole: "template" | "history" | "unknown";
  structureSummary: string[];
  styleSummary: string[];
  usefulPhrases: string[];
  logicChain: MaterialSummary["logic_chain"];
  templateSlots: Array<{
    section: string;
    slotName: string;
    fillRule: string;
    sourceHint: string;
  }>;
  sectionIntents: Array<{
    section: string;
    intent: string;
    trigger: string;
  }>;
};

export type NormalizedRule = {
  id: string;
  title: string;
  status: Rule["status"];
  scope: string;
  docTypes: string[];
  audiences: string[];
  sourceMaterials: string[];
  confidence: number;
};

export type NormalizedFeedback = {
  id: string;
  taskId: string;
  relatedRuleIds: string[];
  feedbackType: string;
  severity: string;
  action: string;
  affectedParagraph: string;
  affectedSection: string;
  affectsStructure: string;
  selectedText: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  createdAt: string;
};

export function normalizeTaskAnalysis(taskAnalysis: TaskAnalysis): NormalizedTaskAnalysis {
  return {
    taskType: taskAnalysis.task_type,
    audience: taskAnalysis.audience,
    scenario: taskAnalysis.scenario,
    goal: taskAnalysis.goal,
    mustInclude: taskAnalysis.must_include,
    constraints: taskAnalysis.constraints,
    rawFacts: taskAnalysis.raw_facts,
    missingInfo: taskAnalysis.missing_info,
    riskFlags: taskAnalysis.risk_flags,
    confidence: taskAnalysis.confidence,
  };
}

export function normalizeMaterialSummary(material: MaterialSummary): NormalizedMaterialSummary {
  return {
    materialId: material.material_id,
    title: material.title,
    docType: material.doc_type,
    materialRole: material.material_role ?? "unknown",
    structureSummary: material.structure_summary,
    styleSummary: material.style_summary,
    usefulPhrases: material.useful_phrases,
    logicChain: material.logic_chain,
    templateSlots: material.template_slots.map((item) => ({
      section: item.section,
      slotName: item.slot_name,
      fillRule: item.fill_rule,
      sourceHint: item.source_hint,
    })),
    sectionIntents: material.section_intents.map((item) => ({
      section: item.section,
      intent: item.intent,
      trigger: item.trigger,
    })),
  };
}

export function normalizeRule(rule: Rule): NormalizedRule {
  return {
    id: rule.id,
    title: rule.title,
    status: rule.status,
    scope: rule.scope,
    docTypes: rule.docTypes,
    audiences: rule.audiences,
    sourceMaterials: rule.sourceMaterials,
    confidence: rule.confidence,
  };
}

export function normalizeFeedback(feedback: Feedback): NormalizedFeedback {
  return {
    id: feedback.id,
    taskId: feedback.taskId,
    relatedRuleIds: feedback.relatedRuleIds,
    feedbackType: feedback.feedbackType,
    severity: feedback.severity,
    action: feedback.action,
    affectedParagraph: feedback.affectedParagraph,
    affectedSection: feedback.affectedSection,
    affectsStructure: feedback.affectsStructure,
    selectedText: feedback.selectedText ?? "",
    selectionStart: feedback.selectionStart ?? null,
    selectionEnd: feedback.selectionEnd ?? null,
    createdAt: feedback.createdAt,
  };
}
