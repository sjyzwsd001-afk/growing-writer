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

export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
export type DiagnosisResult = z.infer<typeof diagnosisResultSchema>;
export type OutlineResult = z.infer<typeof outlineResultSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type FeedbackAnalysis = z.infer<typeof feedbackAnalysisSchema>;
