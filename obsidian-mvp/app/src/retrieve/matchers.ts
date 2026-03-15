import type { Material, MatchedRule, Rule, Task } from "../types/domain.js";

export function matchRules(task: Task, rules: Rule[]): MatchedRule[] {
  return rules
    .filter((rule) => rule.status !== "disabled")
    .map((rule) => {
      let priority = 50;
      const reasons: string[] = [];

      if (rule.status === "confirmed") {
        priority -= 20;
        reasons.push("已确认规则");
      }
      if (rule.docTypes.includes(task.docType)) {
        priority -= 15;
        reasons.push("文体匹配");
      }
      if (rule.audiences.includes(task.audience)) {
        priority -= 10;
        reasons.push("受众匹配");
      }
      if (!rule.docTypes.length && !rule.audiences.length) {
        priority -= 5;
        reasons.push("通用规则");
      }

      return {
        rule_id: rule.id,
        title: rule.title,
        priority,
        reason: reasons.join("，") || "基础候选规则",
      };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 8);
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
