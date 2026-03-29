import { z } from "zod";

export const taskAnalysisSchema = z.object({
  task_type: z.string(),
  audience: z.string(),
  scenario: z.string(),
  goal: z.string(),
  must_include: z.array(z.string()),
  constraints: z.array(z.string()),
  raw_facts: z.array(z.string()),
  missing_info: z.array(z.string()),
  risk_flags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const diagnosisResultSchema = z.object({
  readiness: z.enum(["ready", "partial", "blocked"]),
  diagnosis_summary: z.string(),
  recommended_structure: z.array(
    z.object({
      section: z.string(),
      purpose: z.string(),
      must_cover: z.array(z.string()),
    }),
  ),
  missing_info: z.array(z.string()),
  applied_rules: z.array(z.string()),
  reference_materials: z.array(z.string()),
  writing_risks: z.array(z.string()),
  next_action: z.string(),
});

export const outlineResultSchema = z.object({
  outline_title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      purpose: z.string(),
      key_points: z.array(z.string()),
      source_basis: z.array(z.string()),
    }),
  ),
  tone_notes: z.array(z.string()),
  coverage_check: z.array(z.string()),
  constraint_checks: z
    .object({
      section_order_ok: z.boolean(),
      section_order_missing: z.array(z.string()),
      requirement_gaps: z.array(
        z.object({
          section: z.string(),
          missing: z.array(z.string()),
        }),
      ),
      warnings: z.array(z.string()),
    })
    .optional(),
});

export const draftResultSchema = z.object({
  draft_markdown: z.string(),
  self_review: z.object({
    strengths: z.array(z.string()),
    risks: z.array(z.string()),
    missing_points: z.array(z.string()),
    rule_violations: z.array(z.string()),
  }),
  revision_suggestions: z.array(z.string()),
  constraint_checks: z
    .object({
      section_order_ok: z.boolean(),
      section_order_missing: z.array(z.string()),
      requirement_gaps: z.array(
        z.object({
          section: z.string(),
          missing: z.array(z.string()),
        }),
      ),
      fact_coverage: z.array(
        z.object({
          section: z.string(),
          matched: z.array(z.string()),
          unmatched: z.array(z.string()),
        }),
      ),
      warnings: z.array(z.string()),
    })
    .optional(),
});

export const feedbackAnalysisSchema = z.object({
  feedback_type: z.enum([
    "wording",
    "structure",
    "order",
    "logic",
    "missing_info",
    "scenario_mismatch",
    "factual_fix",
  ]),
  feedback_summary: z.string(),
  is_reusable_rule: z.boolean(),
  candidate_rule: z
    .object({
      title: z.string(),
      content: z.string(),
      scope: z.string(),
      doc_types: z.array(z.string()),
      audiences: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
  reasoning: z.string(),
  suggested_update: z.string(),
});

export const materialAnalysisSchema = z.object({
  opening: z.string(),
  body_parts: z.array(z.string()).min(1).max(3),
  ending: z.string(),
  tone: z.string(),
  sentence_style: z.string(),
  logic_order: z.string(),
  taboo: z.string(),
  candidate_rules: z.array(z.string()).max(3),
  logic_chain: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      reason: z.string(),
    }),
  ).max(6),
  template_slots: z.array(
    z.object({
      section: z.string(),
      slot_name: z.string(),
      fill_rule: z.string(),
      source_hint: z.string(),
    }),
  ).max(8),
  section_intents: z.array(
    z.object({
      section: z.string(),
      intent: z.string(),
      trigger: z.string(),
    }),
  ).max(8),
});

export const profileSummarySchema = z.object({
  overall_style: z.object({
    tone: z.string(),
    sentence_style: z.string(),
    typical_length: z.string(),
    detail_preference: z.string(),
  }),
  structure_habits: z.object({
    opening: z.string(),
    body: z.string(),
    ending: z.string(),
  }),
  high_priority_preferences: z.array(z.string()),
  common_taboos: z.array(z.string()),
  scenario_guidance: z.object({
    leadership_report: z.array(z.string()),
    proposal_doc: z.array(z.string()),
    review_doc: z.array(z.string()),
  }),
  stable_rule_summary: z.array(z.string()),
  pending_observations: z.array(z.string()),
});

export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
export type DiagnosisResult = z.infer<typeof diagnosisResultSchema>;
export type OutlineResult = z.infer<typeof outlineResultSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type FeedbackAnalysis = z.infer<typeof feedbackAnalysisSchema>;
export type MaterialAnalysis = z.infer<typeof materialAnalysisSchema>;
export type ProfileSummary = z.infer<typeof profileSummarySchema>;
