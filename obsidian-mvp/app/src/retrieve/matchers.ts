import type { Feedback, Material, MatchedRule, Profile, Rule, Task } from "../types/domain.js";

type RuleMatchInput = {
  task: Task;
  rules: Rule[];
  materials?: Material[];
  profiles?: Profile[];
  feedbackEntries?: Feedback[];
};

type RuleMatchOutput = {
  matchedRules: MatchedRule[];
  decisionLog: string[];
};

const SOURCE_WEIGHTS = {
  template: 1.5,
  confirmed_rule: 1.2,
  candidate_rule: 0.7,
  profile: 1.0,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTemplateMaterial(material: Material): boolean {
  const source = typeof material.frontmatter.source === "string" ? material.frontmatter.source : "";
  return (
    material.tags.some((tag) => /template|模板/i.test(tag)) ||
    /template|模板/i.test(source) ||
    /template|模板/i.test(material.docType)
  );
}

function parseSectionBullets(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, "m");
  const match = regex.exec(content);
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .filter((line) => line !== "-");
}

function extractProfileRules(profiles: Profile[]): MatchedRule[] {
  const entries: MatchedRule[] = [];
  for (const profile of profiles) {
    const highPriority = parseSectionBullets(profile.content, "高优先级偏好").slice(0, 4);
    const taboos = parseSectionBullets(profile.content, "常见禁忌").slice(0, 3);

    highPriority.forEach((item, index) => {
      entries.push({
        rule_id: `profile:${profile.id}:pref:${index + 1}`,
        title: item,
        priority: 80,
        reason: `来自写作画像（${profile.name}）高优先级偏好`,
        source: "profile",
      });
    });
    taboos.forEach((item, index) => {
      entries.push({
        rule_id: `profile:${profile.id}:taboo:${index + 1}`,
        title: `避免：${item}`,
        priority: 82,
        reason: `来自写作画像（${profile.name}）常见禁忌`,
        source: "profile",
      });
    });
  }
  return entries;
}

function recencyFactor(isoDate: string): number {
  if (!isoDate) {
    return 0.95;
  }
  const updatedAt = Date.parse(isoDate);
  if (Number.isNaN(updatedAt)) {
    return 0.95;
  }
  const ageDays = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) {
    return 1.1;
  }
  if (ageDays <= 30) {
    return 1.0;
  }
  if (ageDays <= 90) {
    return 0.9;
  }
  return 0.8;
}

function computeRuleScopeFactor(task: Task, rule: Rule): { factor: number; reasons: string[] } {
  let factor = 1.0;
  const reasons: string[] = [];

  if (rule.docTypes.includes(task.docType)) {
    factor += 0.25;
    reasons.push("文体匹配");
  }
  if (rule.audiences.includes(task.audience)) {
    factor += 0.15;
    reasons.push("受众匹配");
  }

  const scopeText = `${rule.scope} ${rule.content}`.toLowerCase();
  if (task.scenario && scopeText.includes(task.scenario.toLowerCase())) {
    factor += 0.1;
    reasons.push("场景匹配");
  }

  if (!rule.docTypes.length && !rule.audiences.length) {
    factor -= 0.05;
    reasons.push("通用规则");
  }

  return { factor, reasons };
}

function feedbackOverrideFactor(task: Task, rule: Rule, feedbackEntries: Feedback[]): number {
  const hitInTask = feedbackEntries.some(
    (item) => item.taskId === task.id && item.relatedRuleIds.includes(rule.id),
  );
  return hitInTask ? 1.3 : 1.0;
}

function extractOrderPairs(text: string): Array<{ first: string; second: string }> {
  const matches = [...text.matchAll(/先([^，。；\s]{1,10})后([^，。；\s]{1,10})/g)];
  return matches.map((item) => ({ first: item[1], second: item[2] }));
}

function applyConflictPenalty(
  rules: Array<MatchedRule & { _score: number; _signal: string }>,
  decisionLog: string[],
) {
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const left = rules[i];
      const right = rules[j];
      const leftPairs = extractOrderPairs(left._signal);
      const rightPairs = extractOrderPairs(right._signal);
      if (!leftPairs.length || !rightPairs.length) {
        continue;
      }

      let hasConflict = false;
      for (const lp of leftPairs) {
        if (rightPairs.some((rp) => rp.first === lp.second && rp.second === lp.first)) {
          hasConflict = true;
          break;
        }
      }
      if (!hasConflict) {
        continue;
      }

      if (left._score >= right._score) {
        right._score *= 0.72;
        right.overridden_by = left.title;
        decisionLog.push(`冲突裁决：保留「${left.title}」，降权「${right.title}」。`);
      } else {
        left._score *= 0.72;
        left.overridden_by = right.title;
        decisionLog.push(`冲突裁决：保留「${right.title}」，降权「${left.title}」。`);
      }
    }
  }
}

export function matchRulesWithPolicy(input: RuleMatchInput): RuleMatchOutput {
  const materials = input.materials ?? [];
  const profiles = input.profiles ?? [];
  const feedbackEntries = input.feedbackEntries ?? [];
  const templateMaterialIds = new Set(
    materials.filter((material) => isTemplateMaterial(material)).map((material) => material.id),
  );

  const decisionLog: string[] = [];

  const resolvedRules = input.rules
    .filter((rule) => rule.status !== "disabled")
    .map((rule) => {
      const fromTemplate =
        rule.sourceMaterials?.some((materialId) => templateMaterialIds.has(materialId)) ?? false;
      const sourceType: MatchedRule["source"] = fromTemplate
        ? "template"
        : rule.status === "confirmed"
          ? "confirmed_rule"
          : "candidate_rule";
      const sourceWeight = SOURCE_WEIGHTS[sourceType];
      const confidence = clamp(rule.confidence || 0.5, 0.1, 1);
      const recency = recencyFactor(
        typeof rule.frontmatter.updated_at === "string" ? rule.frontmatter.updated_at : "",
      );
      const scopeResult = computeRuleScopeFactor(input.task, rule);
      const override = feedbackOverrideFactor(input.task, rule, feedbackEntries);

      const score = sourceWeight * confidence * recency * scopeResult.factor * override;
      const reasonParts = [
        fromTemplate ? "模板高权重" : "",
        rule.status === "confirmed" ? "已确认规则" : "候选规则",
        ...scopeResult.reasons,
        override > 1 ? "同任务反馈命中" : "",
      ].filter(Boolean);

      return {
        rule_id: rule.id,
        title: rule.title,
        priority: 90,
        reason: reasonParts.join("，") || "规则基础匹配",
        source: sourceType,
        overridden_by: undefined,
        _score: score,
        _signal: `${rule.title}\n${rule.content}`,
      };
    });

  const profileRules = extractProfileRules(profiles).map((rule) => ({
    ...rule,
    _score: SOURCE_WEIGHTS.profile * 0.9,
    _signal: rule.title,
  }));

  const all = [...resolvedRules, ...profileRules];
  applyConflictPenalty(all, decisionLog);

  const sorted = all
    .sort((a, b) => b._score - a._score)
    .slice(0, 10)
    .map((item, index) => {
      const normalizedScore = Number(item._score.toFixed(3));
      const priority = 100 - Math.min(95, Math.round(item._score * 22)) + index;
      return {
        rule_id: item.rule_id,
        title: item.title,
        priority,
        reason: item.reason,
        source: item.source,
        effective_score: normalizedScore,
        overridden_by: item.overridden_by,
      } satisfies MatchedRule;
    });

  decisionLog.unshift(
    `权重策略：template=${SOURCE_WEIGHTS.template}, confirmed=${SOURCE_WEIGHTS.confirmed_rule}, candidate=${SOURCE_WEIGHTS.candidate_rule}, profile=${SOURCE_WEIGHTS.profile}`,
  );
  if (!decisionLog.some((line) => line.startsWith("冲突裁决"))) {
    decisionLog.push("冲突裁决：本次未发现显式冲突规则。");
  }
  decisionLog.push(`最终启用规则数：${sorted.length}`);

  return { matchedRules: sorted, decisionLog };
}

export function matchRules(task: Task, rules: Rule[]): MatchedRule[] {
  return matchRulesWithPolicy({ task, rules }).matchedRules;
}

export function matchMaterials(task: Task, materials: Material[]): Material[] {
  return materials
    .map((material) => {
      let score = 0;
      if (material.docType && material.docType === task.docType) {
        score += 4;
      }
      if (material.audience && material.audience === task.audience) {
        score += 3;
      }
      if (material.scenario && material.scenario === task.scenario) {
        score += 2;
      }
      if (material.quality === "high") {
        score += 2;
      }
      if (material.tags.some((tag) => /template|模板/i.test(tag))) {
        score += 6;
      }
      return { material, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.material);
}
