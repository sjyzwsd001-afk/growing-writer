import type { Material, MaterialSummary } from "../types/domain.js";

function takeLines(content: string, count: number): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count);
}

export function summarizeMaterial(material: Material): MaterialSummary {
  return {
    material_id: material.id,
    title: material.title,
    doc_type: material.docType,
    structure_summary: takeLines(material.content, 3),
    style_summary: [
      material.quality ? `质量标记：${material.quality}` : "",
      material.audience ? `面向对象：${material.audience}` : "",
      material.scenario ? `场景：${material.scenario}` : "",
    ].filter(Boolean),
    useful_phrases: takeLines(material.content, 2),
  };
}
