import type {
  EvidenceCard,
  MaterialSummary,
  MatchedRule,
  Profile,
  TemplateRewriteStep,
} from "../types/domain.js";
import type {
  DiagnosisResult,
  OutlineResult,
  TaskAnalysis,
} from "../types/schemas.js";
import {
  normalizeMaterialSummary,
  normalizeTaskAnalysis,
} from "../types/normalize.js";

function clip(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clipList(items: string[], maxItems: number, maxItemLength: number): string[] {
  return items
    .map((item) => clip(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function compactTaskAnalysis(taskAnalysis: TaskAnalysis): Record<string, unknown> {
  const normalized = normalizeTaskAnalysis(taskAnalysis);
  return {
    task_type: clip(normalized.taskType, 60),
    audience: clip(normalized.audience, 60),
    scenario: clip(normalized.scenario, 80),
    goal: clip(normalized.goal, 140),
    must_include: clipList(normalized.mustInclude, 6, 120),
    constraints: clipList(normalized.constraints, 6, 120),
    raw_facts: clipList(normalized.rawFacts, 8, 140),
    missing_info: clipList(normalized.missingInfo, 6, 120),
    risk_flags: clipList(normalized.riskFlags, 6, 120),
    confidence: normalized.confidence,
  };
}

export function compactMatchedRules(matchedRules: MatchedRule[]): Array<Record<string, unknown>> {
  return matchedRules.slice(0, 4).map((rule) => ({
    title: clip(rule.title, 80),
    reason: clip(rule.reason, 120),
    priority: rule.priority,
    source: rule.source ?? "unknown",
    effective_score: rule.effective_score ?? null,
    overridden_by: rule.overridden_by ?? null,
  }));
}

export function compactMaterialSummaries(
  materialSummaries: MaterialSummary[],
): Array<Record<string, unknown>> {
  return materialSummaries.slice(0, 4).map((rawMaterial) => {
    const material = normalizeMaterialSummary(rawMaterial);
    return {
      title: clip(material.title, 80),
      doc_type: clip(material.docType, 50),
      material_role: material.materialRole,
      structure_summary: clipList(material.structureSummary, 2, 100),
      style_summary: clipList(material.styleSummary, 3, 80),
      useful_phrases: clipList(material.usefulPhrases, 1, 100),
      logic_chain: material.logicChain.slice(0, 4).map((item) => ({
        from: item.from,
        to: item.to,
        reason: clip(item.reason, 90),
      })),
      template_slots: material.templateSlots.slice(0, 5).map((item) => ({
        section: clip(item.section, 120),
        slot_name: clip(item.slotName, 70),
        fill_rule: clip(item.fillRule, 120),
        source_hint: clip(item.sourceHint, 90),
      })),
      section_intents: material.sectionIntents.slice(0, 5).map((item) => ({
        section: item.section,
        intent: clip(item.intent, 90),
        trigger: clip(item.trigger, 80),
      })),
    };
  });
}

export function compactEvidenceCards(
  evidenceCards: EvidenceCard[],
): Array<Record<string, unknown>> {
  return evidenceCards.slice(0, 3).map((card) => ({
    card_id: card.card_id,
    material_title: clip(card.material_title, 80),
    excerpt: clip(card.excerpt, 90),
    relevance: clip(card.relevance, 60),
  }));
}

export function compactProfiles(profiles: Profile[]): Array<Record<string, unknown>> {
  return profiles.slice(0, 2).map((profile) => ({
    id: profile.id,
    name: clip(profile.name, 60),
    content: clip(profile.content, 420),
  }));
}

export function compactTemplateRewritePlan(
  rewriteSteps: TemplateRewriteStep[],
): Array<Record<string, unknown>> {
  return rewriteSteps.slice(0, 6).map((step) => ({
    section: step.section,
    slot_name: clip(step.slot_name, 90),
    intent: clip(step.intent, 90),
    assigned_facts: clipList(step.assigned_facts, 5, 140),
    assigned_requirements: clipList(step.assigned_requirements, 5, 100),
    assignment_confidence:
      typeof step.assignment_confidence === "number"
        ? Number(step.assignment_confidence.toFixed(2))
        : undefined,
    template_section_excerpt: clip(step.template_section_excerpt ?? "", 220),
    template_writing_pattern: clip(step.template_writing_pattern ?? "", 100),
    content_hint_warning: clip(step.content_hint_warning ?? "", 120),
    history_section_hints: (step.history_section_hints ?? []).slice(0, 3).map((item) => ({
      material_title: clip(item.material_title, 70),
      section: clip(item.section, 120),
      normalized_section: clip(item.normalized_section ?? "", 80),
      excerpt: clip(item.excerpt ?? "", 180),
      writing_pattern: clip(item.writing_pattern ?? "", 100),
    })),
    fill_strategy: clip(step.fill_strategy, 120),
    source_hint: clip(step.source_hint, 90),
    evidence_card_ids: clipList(step.evidence_card_ids, 3, 20),
    logic_after: step.logic_after
      ? {
          from: step.logic_after.from,
          to: step.logic_after.to,
          reason: clip(step.logic_after.reason, 140),
        }
      : null,
  }));
}

export function compactDiagnosis(diagnosis: DiagnosisResult): Record<string, unknown> {
  return {
    readiness: diagnosis.readiness,
    diagnosis_summary: clip(diagnosis.diagnosis_summary, 160),
    recommended_structure: diagnosis.recommended_structure.slice(0, 4).map((section) => ({
      section: clip(section.section, 60),
      purpose: clip(section.purpose, 100),
      must_cover: clipList(section.must_cover, 4, 80),
    })),
    missing_info: clipList(diagnosis.missing_info, 6, 100),
    applied_rules: clipList(diagnosis.applied_rules, 6, 80),
    reference_materials: clipList(diagnosis.reference_materials, 6, 80),
    writing_risks: clipList(diagnosis.writing_risks, 6, 100),
    next_action: clip(diagnosis.next_action, 120),
  };
}

export function compactOutline(outline: OutlineResult): Record<string, unknown> {
  return {
    outline_title: clip(outline.outline_title, 100),
    sections: outline.sections.slice(0, 5).map((section) => ({
      heading: clip(section.heading, 60),
      purpose: clip(section.purpose, 100),
      key_points: clipList(section.key_points, 5, 80),
      source_basis: clipList(section.source_basis, 4, 60),
    })),
    tone_notes: clipList(outline.tone_notes, 6, 60),
    coverage_check: clipList(outline.coverage_check, 6, 80),
  };
}
