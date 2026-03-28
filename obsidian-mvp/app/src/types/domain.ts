export type Frontmatter = Record<string, unknown>;

export type MarkdownDocument = {
  path: string;
  frontmatter: Frontmatter;
  content: string;
};

export type Material = MarkdownDocument & {
  id: string;
  title: string;
  docType: string;
  audience: string;
  scenario: string;
  quality: string;
  tags: string[];
};

export type Rule = MarkdownDocument & {
  id: string;
  title: string;
  status: "candidate" | "confirmed" | "disabled";
  scope: string;
  docTypes: string[];
  audiences: string[];
  sourceMaterials: string[];
  confidence: number;
};

export type Task = MarkdownDocument & {
  id: string;
  title: string;
  docType: string;
  audience: string;
  scenario: string;
  status: string;
  sourceMaterials: string[];
  matchedRules: string[];
};

export type Feedback = MarkdownDocument & {
  id: string;
  taskId: string;
  relatedRuleIds: string[];
  feedbackType: string;
  severity: string;
  action: string;
  affectedParagraph: string;
  affectedSection: string;
  affectsStructure: string;
  selectedText?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  createdAt: string;
};

export type Profile = MarkdownDocument & {
  id: string;
  name: string;
  version: number;
};

export type MaterialSummary = {
  material_id: string;
  title: string;
  doc_type: string;
  material_role?: "template" | "history" | "unknown";
  structure_summary: string[];
  style_summary: string[];
  useful_phrases: string[];
  logic_chain: string[];
  template_slots: string[];
  section_intents: string[];
};

export type TemplateRewriteStep = {
  section: string;
  slot_name: string;
  intent: string;
  assigned_facts: string[];
  assigned_requirements: string[];
  fill_strategy: string;
  source_hint: string;
  evidence_card_ids: string[];
  logic_after?: string | null;
};

export type TemplateRewriteHint = {
  template_title: string;
  rewrite_steps: TemplateRewriteStep[];
  rewrite_plan: string[];
};

export type EvidenceCard = {
  card_id: string;
  material_id: string;
  material_title: string;
  excerpt: string;
  relevance: string;
};

export type MatchedRule = {
  rule_id: string;
  title: string;
  priority: number;
  reason: string;
  source?: "template" | "confirmed_rule" | "candidate_rule" | "profile";
  effective_score?: number;
  overridden_by?: string;
};
