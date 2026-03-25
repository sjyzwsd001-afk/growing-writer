const state = {
  dashboard: null,
  currentView: "create",
  settingsPage: "models",
  wizardStep: 1,
  wizardCheckPassed: false,
  wizardCheckReport: null,
  currentTask: null,
  currentWorkflowRun: null,
  feedbackSelection: null,
  feedbackHistory: [],
  latestFeedbackByLocation: {},
  pendingAnnotations: [],
  activeAnnotationIndex: -1,
  generatedDraftBaseline: "",
  latestFeedbackLearnResult: null,
  currentGenerationContext: null,
  workflowDefinition: null,
  workflowEditorDefinition: null,
  oauthStartAttempt: 0,
  editingLlmProfileId: "",
};

const MAX_WIZARD_STEP = 7;
const DEFAULT_API_TIMEOUT_MS = 30000;
const WORKFLOW_START_TIMEOUT_MS = 90000;
const trustedOrigins = new Set([
  window.location.origin,
  window.location.origin.replace("127.0.0.1", "localhost"),
  window.location.origin.replace("localhost", "127.0.0.1"),
]);

const DEFAULT_FLOW_STAGES = [
  { id: "INTAKE_BACKGROUND", label: "问背景", description: "收集背景、目标、约束" },
  { id: "INTAKE_MATERIALS", label: "问材料", description: "收集历史材料、补充事实" },
  { id: "SELECT_TEMPLATE", label: "问模板", description: "选择模板与结构偏好" },
  { id: "GENERATE_DRAFT", label: "写作", description: "生成诊断、提纲与初稿" },
  { id: "REVIEW_DIAGNOSE", label: "检查", description: "执行规则裁决与诊断复核" },
  { id: "USER_CONFIRM_OR_EDIT", label: "确认", description: "用户修改、批注、反馈" },
  { id: "FINALIZE_AND_LEARN", label: "定稿", description: "定稿并学习反馈" },
];

const WIZARD_STEP_STAGE_MAP = {
  1: "INTAKE_BACKGROUND",
  2: "INTAKE_MATERIALS",
  3: "SELECT_TEMPLATE",
  4: "GENERATE_DRAFT",
  5: "REVIEW_DIAGNOSE",
  6: "USER_CONFIRM_OR_EDIT",
  7: "FINALIZE_AND_LEARN",
};

const BUTTON_TOOLTIP_BY_ACTION = {
  "view-material": "查看这份材料或模板的摘要与原文。",
  "view-rule": "查看这条规则的摘要、来源和原文。",
  "view-profile": "查看这份写作画像的详细内容。",
  "view-feedback": "查看这条反馈记录的详情与学习结果。",
  "copy-path": "复制这条记录对应的文件或目录路径。",
  "analyze-material": "重新分析这份材料，更新角色判断、结构和规则线索。",
  "material-mark-template": "把这份材料转成正式模板，后续生成会优先参考它。",
  "material-mark-history": "把这份模板转回历史材料，不再作为正式模板优先使用。",
  "rule-set-scope": "修改这条规则的适用范围、文种或对象。",
  "rule-view-versions": "查看这条规则的历史版本和变化记录。",
  "rule-rollback": "把这条规则回滚到较早版本。",
  "rule-confirm": "确认这条候选规则，让它正式生效。",
  "rule-disable": "停用这条规则，后续生成不再默认遵守。",
  "rule-reject": "拒绝这条候选规则，不再继续采用。",
  "feedback-confirm-rule": "把这条反馈里沉淀出的候选规则直接确认入库。",
  "learn-feedback": "重新学习这条反馈，更新候选规则和理解结果。",
  "view-workflow": "查看这次写作流程的阶段事件与流转记录。",
  "view-workflow-definition": "查看当前 7 步流程的 DSL 定义。",
  "view-observability": "查看这次模型调用的耗时、结果和回退情况。",
  "remove-annotation": "从本轮批注清单里删除这条批注。",
  "edit-annotation": "把这条批注回填到输入区，继续修改。",
  "focus-annotation": "把正文光标跳到这条批注对应的位置。",
  "annotation-up": "把这条批注往前移动一位。",
  "annotation-down": "把这条批注往后移动一位。",
  "confirm-generated-rule": "确认系统刚生成的候选规则并正式入库。",
  "reject-generated-rule": "暂不采用这条候选规则，但保留这次学习记录。",
  "llm-edit": "编辑这张模型卡片的接入配置。",
  "llm-activate": "切换为当前默认使用的模型卡片。",
  "llm-delete": "删除这张模型卡片。",
  "stage-up": "把这个流程阶段向前移动一位。",
  "stage-down": "把这个流程阶段向后移动一位。",
  "stage-initial": "把这个阶段设为流程起点。",
  "stage-delete": "删除这个流程阶段。",
};

const BUTTON_TOOLTIP_BY_TEXT = {
  "新建写作": "进入 7 步引导式写作流程。",
  "设置": "查看模型、知识库、规则、画像和调试信息。",
  "模型": "查看和管理模型卡片。",
  "知识库": "查看材料、模板和 Obsidian 对接信息。",
  "写作大脑": "查看规则库、写作画像和反馈学习结果。",
  "操作结果": "查看设置操作后的摘要和原始返回。",
  "调试": "查看流程运行记录、模型调用和 DSL 编辑区。",
  "新建卡片": "新增一个模型配置卡片。",
  "开始 OAuth 登录": "发起 OpenAI Codex OAuth 授权登录。",
  "保存为模型卡片": "保存当前填写的模型配置，生成一张新卡片。",
  "保存卡片修改": "把当前编辑内容保存回这张模型卡片。",
  "关闭": "关闭当前弹层或结果区域。",
  "上一步": "返回前一个写作步骤。",
  "下一步": "进入下一个写作步骤。",
  "运行检查": "对当前写作输入做规则和完整性检查。",
  "去修改正文": "跳转到正文编辑区，继续修改和反馈。",
  "捕获正文选区": "读取你在正文里选中的文字，自动定位修改位置。",
  "加入本轮批注清单": "把当前选区、原因和说明加入本轮批注。",
  "清空本轮批注": "清空当前这一轮待提交的批注。",
  "保存当前正文": "先保存当前改好的正文，不立即再生成。",
  "提交反馈并再次生成": "按本轮修改意见学习后，再生成一版新稿。",
  "直接定稿": "把当前正文定为最终稿，并写回任务文件。",
  "刷新画像": "根据材料、规则和反馈重新生成写作画像。",
  "重新加载 DSL": "重新读取当前流程 DSL 定义。",
  "保存 DSL": "保存当前流程 DSL 改动并立即生效。",
  "新增阶段": "在流程里新增一个阶段节点。",
  "查看模板": "查看这份模板的摘要和原文。",
  "查看": "查看这条内容的详情。",
  "复制路径": "复制这条内容对应的文件路径。",
  "编辑": "编辑当前这条配置或内容。",
  "启用": "切换为当前默认使用项。",
  "删除": "删除当前这条内容。",
  "确认": "确认当前候选内容并正式生效。",
  "停用": "暂时停用这条内容。",
  "拒绝": "拒绝这条候选内容。",
  "版本": "查看版本历史。",
  "回滚": "回退到旧版本。",
  "设范围": "设置适用范围。",
  "学习反馈": "重新分析这条反馈并更新学习结果。",
  "导入材料": "把当前填写的内容导入到知识库。",
  "复制 Vault 根目录": "复制当前 Obsidian Vault 的根目录路径。",
  "复制材料目录": "复制 materials 目录路径。",
  "复制任务目录": "复制 tasks 目录路径。",
  "复制规则目录": "复制 rules 目录路径。",
  "复制画像目录": "复制 profiles 目录路径。",
  "复制反馈目录": "复制 feedback 目录路径。",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inferButtonTooltip(button) {
  const view = button.dataset.view || "";
  if (view === "create") {
    return BUTTON_TOOLTIP_BY_TEXT["新建写作"];
  }
  if (view === "settings") {
    return BUTTON_TOOLTIP_BY_TEXT["设置"];
  }

  const settingsPage = button.dataset.settingsPage || "";
  if (settingsPage && BUTTON_TOOLTIP_BY_TEXT[button.textContent.trim()]) {
    return BUTTON_TOOLTIP_BY_TEXT[button.textContent.trim()];
  }

  const label = button.textContent.trim().replace(/\s+/g, " ");
  if (label && BUTTON_TOOLTIP_BY_TEXT[label]) {
    return BUTTON_TOOLTIP_BY_TEXT[label];
  }

  const action = button.dataset.action || "";
  if (action && BUTTON_TOOLTIP_BY_ACTION[action]) {
    return BUTTON_TOOLTIP_BY_ACTION[action];
  }

  if (label) {
    return `点击执行：${label}`;
  }

  return "";
}

function hydrateButtonTooltips(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  scope.querySelectorAll("button").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const tooltip = inferButtonTooltip(button);
    if (tooltip) {
      button.title = tooltip;
      button.setAttribute("aria-label", tooltip);
    }
  });
}

function startButtonTooltipObserver() {
  hydrateButtonTooltips(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLButtonElement) {
          hydrateButtonTooltips(node.parentElement || document);
          return;
        }
        if (node instanceof HTMLElement) {
          hydrateButtonTooltips(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function normalizeTemplateUiCopy(value) {
  return String(value || "")
    .replaceAll("会以高权重参与", "会优先参与")
    .replaceAll("会以高优先级参与", "会优先参与")
    .replaceAll("高权重", "优先")
    .replaceAll("高优先级", "优先")
    .replaceAll("真实模板", "正式模板")
    .replaceAll("建议升模板", "建议转为模板")
    .replaceAll("模板候选", "候选模板");
}

function setInfo(message, isError = false) {
  const summary = document.getElementById("wizard-summary");
  if (!summary) {
    return;
  }
  summary.innerHTML = `<div class="${isError ? "msg error" : "msg"}">${escapeHtml(message)}</div>`;
}

function buildSettingsResultSummary(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if ("roleLabel" in payload && "roleReason" in payload) {
    const summaryItems = [
      { label: "当前角色", value: payload.roleLabel || "-" },
      { label: "当前定位", value: payload.isTemplate ? "正式模板" : payload.recommendTemplatePromotion ? "建议转为模板" : "普通材料" },
      { label: "作用方式", value: payload.roleReason || "-" },
    ];
    return `<div class="result-summary-grid">
      ${summaryItems
        .map(
          (item) => `<div class="result-summary-item">
            <div class="result-summary-label">${escapeHtml(item.label)}</div>
            <strong>${escapeHtml(item.value)}</strong>
          </div>`,
        )
        .join("")}
    </div>`;
  }

  return "";
}

function setSettingsResult(title, payload, options = {}) {
  const container = document.getElementById("settings-result");
  if (!container) {
    return;
  }
  const reveal = options.reveal !== false;
  if (reveal) {
    toggleSettingsPage("results");
  }

  const content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const summary = buildSettingsResultSummary(payload);
  container.innerHTML = `<h3>${escapeHtml(title)}</h3>
    ${summary}
    ${
      summary
        ? `<details class="raw-result-details">
            <summary>查看原始返回</summary>
            <pre>${escapeHtml(content)}</pre>
          </details>`
        : `<pre>${escapeHtml(content)}</pre>`
    }`;
  if (reveal) {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function setSettingsResultPreview(title, summaryHtml, rawText = "") {
  const container = document.getElementById("settings-result");
  if (!container) {
    return;
  }
  toggleSettingsPage("results");

  container.innerHTML = `<h3>${escapeHtml(title)}</h3>
    ${summaryHtml}
    <details class="raw-result-details">
      <summary>查看原文</summary>
      <pre>${escapeHtml(rawText)}</pre>
    </details>`;
  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setTaskBadge(text, isError = false) {
  const badge = document.getElementById("task-badge");
  if (!badge) {
    return;
  }
  badge.textContent = text;
  badge.classList.toggle("danger", isError);
}

async function copyText(text, successMessage) {
  const value = String(text || "").trim();
  if (!value) {
    throw new Error("没有可复制的路径。");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  const status = document.getElementById("obsidian-quick-action-status");
  if (status) {
    status.textContent = successMessage || "已复制到剪贴板。";
  } else {
    setInfo(successMessage || "已复制到剪贴板。");
  }
}

function normalizeLocation(value) {
  const cleaned = String(value || "").trim();
  return cleaned || "全文";
}

function inferFeedbackType(text) {
  const normalized = String(text || "").toLowerCase();
  if (/结构|顺序|层次/.test(normalized)) {
    return "structure";
  }
  if (/逻辑|因果/.test(normalized)) {
    return "logic";
  }
  if (/缺失|没写|遗漏/.test(normalized)) {
    return "missing_info";
  }
  return "wording";
}

function historyStorageKey(taskId) {
  return `gw-feedback-history-${taskId}`;
}

function saveFeedbackHistoryToStorage(taskId) {
  if (!taskId) {
    return;
  }
  localStorage.setItem(
    historyStorageKey(taskId),
    JSON.stringify({
      history: state.feedbackHistory,
      latestByLocation: state.latestFeedbackByLocation,
    }),
  );
}

function loadFeedbackHistoryFromStorage(taskId) {
  state.feedbackHistory = [];
  state.latestFeedbackByLocation = {};
  if (!taskId) {
    return;
  }

  const raw = localStorage.getItem(historyStorageKey(taskId));
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.feedbackHistory = Array.isArray(parsed.history) ? parsed.history : [];
    state.latestFeedbackByLocation =
      parsed.latestByLocation && typeof parsed.latestByLocation === "object"
        ? parsed.latestByLocation
        : {};
  } catch {
    state.feedbackHistory = [];
    state.latestFeedbackByLocation = {};
  }
}

async function api(path, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)} 秒）。如果后台仍停留在旧进程，请重启 \`npm run web\` 后再试。`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseTopLevelSections(raw) {
  const text = String(raw || "").replace(/^---[\s\S]*?---\n?/, "").trim();
  const matches = [...text.matchAll(/^#\s+(.+)\n([\s\S]*?)(?=^#\s+|\Z)/gm)];
  return matches.map((match) => ({
    heading: match[1].trim(),
    body: match[2].trim(),
  }));
}

function getMarkdownSection(raw, heading) {
  const text = String(raw || "").replace(/^---[\s\S]*?---\n?/, "").trim();
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^#{1,6}\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^#{1,6}\\s+|\\Z)`, "m"));
  return match?.[1]?.trim() || "";
}

function parseFrontmatter(raw) {
  const match = String(raw || "").match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  return match[1]
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const item = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
      if (!item) {
        return acc;
      }
      acc[item[1]] = item[2].trim();
      return acc;
    }, {});
}

function takePreviewLines(text, limit = 3) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^#+\s*/, "")
        .replace(/^[-*]\s*/, "")
        .replace(/^>\s*/, ""),
    )
    .filter((line) => line && !/^待补充|待人工确认/.test(line))
    .slice(0, limit);
}

function cleanMetaValue(value) {
  return normalizeTemplateUiCopy(
    String(value || "")
      .replace(/^['"]+|['"]+$/g, "")
      .replace(/^fallback$/i, "本地兜底总结")
      .replace(/^llm$/i, "LLM 自动总结")
      .replace(/^template$/i, "正式模板")
      .replace(/^history$/i, "历史材料")
      .replace(/^rule$/i, "规则")
      .replace(/^feedback$/i, "反馈")
      .replace(/^profile$/i, "画像")
      .replace(/^material$/i, "材料")
      .replace(/^active$/i, "启用中")
      .replace(/^disabled$/i, "已停用")
      .replace(/^candidate$/i, "待确认")
      .replace(/^confirmed$/i, "已确认")
      .replace(/^high$/i, "高质量")
      .replace(/^medium$/i, "中等")
      .replace(/^low$/i, "待提升"),
  );
}

function buildPreviewGrid(items) {
  return `<div class="result-summary-grid">
    ${items
      .filter((item) => item && item.value)
      .map(
        (item) => `<div class="result-summary-item">
          <div class="result-summary-label">${escapeHtml(item.label)}</div>
          <strong>${escapeHtml(item.value)}</strong>
        </div>`,
      )
      .join("")}
  </div>`;
}

function buildDocumentPreview(title, raw, kind) {
  const frontmatter = parseFrontmatter(raw);
  const sections = parseTopLevelSections(raw);
  const getSection = (heading) => sections.find((item) => item.heading === heading)?.body || "";
  const baseMeta = [
    { label: "标题", value: frontmatter.title || title || "未命名" },
    { label: "类型", value: cleanMetaValue(frontmatter.doc_type || frontmatter.feedback_type || kind) },
    { label: "更新时间", value: cleanMetaValue(frontmatter.updated_at || frontmatter.created_at || "-") },
  ];

  if (kind === "material") {
    const bodyPreview = takePreviewLines(getSection("原文内容") || getSection("文档信息"), 4).join(" / ");
    const structurePreview = takePreviewLines(getSection("结构拆解"), 3).join(" / ");
    return `
      ${buildPreviewGrid([
        ...baseMeta,
        { label: "定位", value: cleanMetaValue(frontmatter.source || "普通材料") },
        { label: "质量", value: cleanMetaValue(frontmatter.quality || "-") },
      ])}
      <div class="result-summary-item"><div class="result-summary-label">内容摘要</div><strong>${escapeHtml(bodyPreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">结构线索</div><strong>${escapeHtml(structurePreview || "暂无结构摘要")}</strong></div>
    `;
  }

  if (kind === "rule") {
    const contentPreview = takePreviewLines(getSection("规则内容") || getSection("内容") || raw, 4).join(" / ");
    const sourcePreview = takePreviewLines(getSection("来源") || getSection("来源材料"), 2).join(" / ");
    const effectPreview = takePreviewLines(getSection("适用场景") || getSection("影响") || getSection("说明"), 2).join(" / ");
    return `
      ${buildPreviewGrid([
        ...baseMeta,
        { label: "适用范围", value: cleanMetaValue(frontmatter.scope || "通用") },
        { label: "状态", value: cleanMetaValue(frontmatter.status || "-") },
      ])}
      <div class="result-summary-item"><div class="result-summary-label">这条规则要求什么</div><strong>${escapeHtml(contentPreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">通常在哪些场景会触发</div><strong>${escapeHtml(effectPreview || "暂无场景摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">来源线索</div><strong>${escapeHtml(sourcePreview || "暂无来源摘要")}</strong></div>
    `;
  }

  if (kind === "feedback") {
    const reasonPreview = takePreviewLines(getSection("修改原因") || getSection("批注说明"), 3).join(" / ");
    const changePreview = takePreviewLines(getSection("修改内容") || getSection("内容") || raw, 4).join(" / ");
    const learningPreview = takePreviewLines(getSection("学习结论") || getSection("候选规则") || getSection("系统判断"), 3).join(" / ");
    return `
      ${buildPreviewGrid([
        ...baseMeta,
        { label: "修改位置", value: cleanMetaValue(frontmatter.affected_paragraph || "全文") },
        { label: "建议类型", value: frontmatter.is_reusable_rule === "true" ? "建议入规则" : "本次修改" },
      ])}
      <div class="result-summary-item"><div class="result-summary-label">你这次主要改了什么</div><strong>${escapeHtml(changePreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">修改原因</div><strong>${escapeHtml(reasonPreview || "暂无说明")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">系统这次学到了什么</div><strong>${escapeHtml(learningPreview || "暂无学习结论")}</strong></div>
    `;
  }

  if (kind === "profile") {
    const stylePreview = takePreviewLines(getMarkdownSection(raw, "总体风格"), 3).join(" / ");
    const structurePreview = takePreviewLines(getMarkdownSection(raw, "结构习惯"), 3).join(" / ");
    const preferencePreview = takePreviewLines(getMarkdownSection(raw, "高优先级偏好") || getMarkdownSection(raw, "当前稳定规则摘要"), 2).join(" / ");
    const pendingPreview = takePreviewLines(getMarkdownSection(raw, "待确认观察"), 2).join(" / ");
    return `
      ${buildPreviewGrid([
        ...baseMeta,
        { label: "生成方式", value: cleanMetaValue(frontmatter.generated_by || "-") },
        { label: "版本", value: cleanMetaValue(frontmatter.version || "1") },
      ])}
      <div class="result-summary-item"><div class="result-summary-label">总体风格</div><strong>${escapeHtml(stylePreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">结构习惯</div><strong>${escapeHtml(structurePreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">高优先级偏好</div><strong>${escapeHtml(preferencePreview || "暂无摘要")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">当前待确认观察</div><strong>${escapeHtml(pendingPreview || "暂无")}</strong></div>
    `;
  }

  return `
    ${buildPreviewGrid(baseMeta)}
    <div class="result-summary-item"><div class="result-summary-label">内容摘要</div><strong>${escapeHtml(takePreviewLines(raw, 4).join(" / ") || "暂无摘要")}</strong></div>
  `;
}

async function getTaskDraftFromFile(path) {
  const doc = await api(`/api/document?path=${encodeURIComponent(path)}`);
  const sections = parseTopLevelSections(doc.raw);
  const draft = sections.find((item) => item.heading === "初稿");
  return draft?.body || "";
}

function toggleView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
}

function toggleSettingsPage(pageName) {
  state.settingsPage = pageName || "models";
  document.querySelectorAll(".settings-subtab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.settingsPage === state.settingsPage);
  });
  document.querySelectorAll(".settings-page").forEach((page) => {
    page.classList.toggle("active", page.dataset.settingsPage === state.settingsPage);
  });
}

function updateWizardSummary() {
  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);
  const selectedCount = formData.getAll("sourceMaterialIds").length;
  const title = String(formData.get("title") || "").trim();
  const docType = String(formData.get("docType") || "").trim();
  const background = String(formData.get("background") || "").trim();
  const facts = String(formData.get("facts") || "").trim();
  const hasUpload =
    formData.get("backgroundUpload") instanceof File && formData.get("backgroundUpload").size > 0;
  const templateTitle =
    document.querySelector("#template-selector option:checked")?.textContent || "不使用模板";
  const templateMode = String(formData.get("templateMode") || "hybrid");
  const overrideCount = String(formData.get("templateOverrides") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const readiness = [
    { label: "任务标题", ok: Boolean(title), detail: title || "未填写" },
    { label: "文档类型", ok: Boolean(docType), detail: docType || "未填写" },
    { label: "本次背景", ok: Boolean(background || facts || hasUpload), detail: background || facts || (hasUpload ? "已上传背景文件" : "未填写") },
    { label: "检查结果", ok: state.wizardCheckPassed, detail: state.wizardCheckPassed ? "已通过" : "尚未通过" },
    { label: "人工确认", ok: document.getElementById("wizard-confirm-check")?.checked, detail: document.getElementById("wizard-confirm-check")?.checked ? "已勾选" : "未勾选" },
  ];
  const modeLabel = templateMode === "strict" ? "严格套用" : templateMode === "light" ? "轻参考" : "平衡模式";
  document.getElementById("wizard-summary").innerHTML = `
    <div class="result-summary-grid">
      <div class="result-summary-item"><div class="result-summary-label">任务</div><strong>${escapeHtml(title || "未填写")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">文档类型</div><strong>${escapeHtml(docType || "未填写")}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">模板</div><strong>${escapeHtml(templateTitle)}</strong></div>
      <div class="result-summary-item"><div class="result-summary-label">历史材料</div><strong>${escapeHtml(String(selectedCount))} 篇</strong></div>
    </div>
    <div class="mini">模板用法：${escapeHtml(modeLabel)} / 额外提醒 ${escapeHtml(String(overrideCount))} 条</div>
    <div class="wizard-readiness-list">
      ${readiness
        .map(
          (item) => `<div class="wizard-readiness-item ${item.ok ? "ok" : "pending"}">
            <strong>${escapeHtml(item.label)}</strong>
            <div class="mini">${escapeHtml(item.detail)}</div>
          </div>`,
        )
        .join("")}
    </div>
  `;
}

function runWizardCheck() {
  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);

  const title = String(formData.get("title") || "").trim();
  const docType = String(formData.get("docType") || "").trim();
  const background = String(formData.get("background") || "").trim();
  const facts = String(formData.get("facts") || "").trim();
  const mustInclude = String(formData.get("mustInclude") || "").trim();
  const specialRequirements = String(formData.get("specialRequirements") || "").trim();
  const materialCount = formData.getAll("sourceMaterialIds").length;
  const templateId = String(formData.get("templateId") || "").trim();
  const hasUpload =
    formData.get("backgroundUpload") instanceof File && formData.get("backgroundUpload").size > 0;

  const blockers = [];
  const warnings = [];

  if (!title) {
    blockers.push("任务标题未填写。");
  }
  if (!docType) {
    blockers.push("文档类型未填写。");
  }
  if (!background && !facts && !hasUpload) {
    blockers.push("本次背景素材为空：请填写背景/事实或上传背景文件。");
  }
  if (!mustInclude) {
    warnings.push("“必须包含的信息”为空，可能导致生成遗漏重点。");
  }
  if (!materialCount && !templateId) {
    warnings.push("未选择历史材料或模板，风格迁移能力会下降。");
  }
  if (!specialRequirements) {
    warnings.push("“特殊要求”为空，建议补充结构偏好（如先意义后措施）。");
  }

  const ok = blockers.length === 0;
  const report = { ok, blockers, warnings };
  state.wizardCheckPassed = ok;
  state.wizardCheckReport = report;
  return report;
}

function renderWizardCheckResult(report) {
  const container = document.getElementById("wizard-check-result");
  const form = document.getElementById("wizard-form");
  if (!container) {
    return;
  }

  if (!report) {
    container.innerHTML = `<div>点击“执行检查”开始。</div>`;
    return;
  }

  const formData = form ? new FormData(form) : new FormData();
  const summaryItems = [
    { label: "阻塞项", value: String(report.blockers.length) },
    { label: "提醒项", value: String(report.warnings.length) },
    { label: "背景输入", value: String(formData.get("background") || "").trim() || String(formData.get("facts") || "").trim() ? "已提供" : "偏少" },
    { label: "历史材料", value: `${formData.getAll("sourceMaterialIds").length} 篇` },
  ];

  const blockerLines = report.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const warningLines = report.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  container.innerHTML = `
    <div class="${report.ok ? "msg" : "msg error"}">${report.ok ? "检查通过，可进入确认步骤。" : "检查未通过，请先修复阻塞项。"}</div>
    <div class="result-summary-grid">
      ${summaryItems
        .map(
          (item) => `<div class="result-summary-item"><div class="result-summary-label">${escapeHtml(item.label)}</div><strong>${escapeHtml(item.value)}</strong></div>`,
        )
        .join("")}
    </div>
    <div><strong>阻塞项</strong></div>
    <ul>${blockerLines || "<li>无</li>"}</ul>
    <div><strong>提醒项</strong></div>
    <ul>${warningLines || "<li>无</li>"}</ul>
  `;
}

function validateStepBeforeNext(step) {
  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);
  if (step === 1) {
    if (!String(formData.get("title") || "").trim() || !String(formData.get("docType") || "").trim()) {
      return "请先填写任务标题和文档类型。";
    }
  }
  if (step === 4) {
    const background = String(formData.get("background") || "").trim();
    const facts = String(formData.get("facts") || "").trim();
    const hasUpload =
      formData.get("backgroundUpload") instanceof File && formData.get("backgroundUpload").size > 0;
    if (!background && !facts && !hasUpload) {
      return "请至少填写背景/事实或上传背景文件，再进入检查步骤。";
    }
  }
  if (step === 5 && !state.wizardCheckPassed) {
    return "请先在 Step 5 执行检查并通过。";
  }
  if (step === 6 && !state.currentTask?.id) {
    return "请先点击“确认并生成初稿”，生成后才能进入定稿步骤。";
  }
  return "";
}

function getWorkflowStagesForUi() {
  const fromDsl = state.workflowDefinition?.definition?.stages;
  if (Array.isArray(fromDsl) && fromDsl.length) {
    return fromDsl.map((stage) => ({
      id: String(stage.id || ""),
      label: String(stage.label || stage.id || "未命名阶段"),
      description: String(stage.description || ""),
    }));
  }
  return DEFAULT_FLOW_STAGES;
}

function deriveActiveStageIdByWizardStep(stages) {
  const preferredStageId = WIZARD_STEP_STAGE_MAP[state.wizardStep] || "";
  if (preferredStageId && stages.some((stage) => stage.id === preferredStageId)) {
    return preferredStageId;
  }
  const index = Math.max(0, Math.min(state.wizardStep - 1, stages.length - 1));
  return stages[index]?.id || preferredStageId;
}

function renderWorkflowStageTracker() {
  const tracker = document.getElementById("workflow-stage-tracker");
  const note = document.getElementById("workflow-stage-note");
  const nextAction = document.getElementById("workflow-next-action");
  const editorStage = document.getElementById("workflow-editor-stage");
  if (!tracker || !note || !editorStage || !nextAction) {
    return;
  }

  const stages = getWorkflowStagesForUi();
  if (!stages.length) {
    tracker.innerHTML = `<div class="empty">暂无流程定义。</div>`;
    note.textContent = "当前阶段：未定义";
    nextAction.textContent = "下一步：等待流程定义。";
    editorStage.textContent = "当前编排阶段：未开始";
    return;
  }

  const run = state.currentWorkflowRun;
  const activeStageId = run?.currentStage || deriveActiveStageIdByWizardStep(stages);
  const activeIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === activeStageId),
  );

  tracker.innerHTML = stages
    .map((stage, index) => {
      let status = "pending";
      if (run) {
        if (run.status === "completed") {
          status = index <= activeIndex ? "completed" : "pending";
        } else if (index < activeIndex) {
          status = "completed";
        } else if (index === activeIndex) {
          status = "active";
        }
      } else if (index < activeIndex) {
        status = "completed";
      } else if (index === activeIndex) {
        status = "active";
      }
      const statusLabel = status === "active" ? "当前" : status === "completed" ? "已完成" : "待进行";
      return `<div class="workflow-stage-item ${status}">
        <div class="stage-no">第 ${index + 1} 步</div>
        <strong>${escapeHtml(stage.label || stage.id)}</strong>
        <div class="mini">${escapeHtml(stage.description || "")}</div>
        <div class="stage-status">${escapeHtml(statusLabel)}</div>
      </div>`;
    })
    .join("");

  const activeStage = stages[activeIndex] || stages[0];
  const statusText = run ? `（Run: ${run.status || "running"}）` : "（表单引导）";
  note.textContent = `当前阶段：${activeStage.label || activeStage.id}${statusText}`;
  nextAction.textContent = `下一步：${getNextActionHint(activeIndex, stages, Boolean(run))}`;
  editorStage.textContent = run
    ? `当前编排阶段：${activeStage.label || activeStage.id} / ${run.currentStage || "-"}`
    : "当前编排阶段：未开始（先完成前4步并生成）";
}

function getNextActionHint(activeIndex, stages, hasRun) {
  if (hasRun) {
    const active = stages[activeIndex];
    if (!active) {
      return "查看当前运行状态。";
    }
    if (active.id === "USER_CONFIRM_OR_EDIT") {
      return "修改正文、补批注，或直接定稿。";
    }
    if (active.id === "FINALIZE_AND_LEARN") {
      return "当前流程已到定稿阶段，可以继续回看和复盘。";
    }
    return `等待当前阶段完成：${active.label || active.id}。`;
  }

  const hintsByStep = {
    1: "先填写任务标题和文档类型。",
    2: "挑 1 到 3 篇最像你写法的历史材料，或者直接跳过。",
    3: "如果这类材料有固定套路，选一个模板。",
    4: "补一段背景说明，再写几条关键事实。",
    5: "点击“执行检查”，先看有没有关键内容缺失。",
    6: "确认准备状态无误后，勾选并开始生成。",
    7: "到下方编辑区继续改稿和定稿。",
  };
  return hintsByStep[state.wizardStep] || "继续完成当前步骤。";
}

function updateWizardStep() {
  document.getElementById("wizard-step-index").textContent = String(state.wizardStep);
  document.querySelectorAll(".wizard-step").forEach((step) => {
    step.classList.toggle("active", Number(step.dataset.step) === state.wizardStep);
  });
  document.getElementById("wizard-prev").disabled = state.wizardStep === 1;
  document.getElementById("wizard-next").classList.toggle("hidden", state.wizardStep >= MAX_WIZARD_STEP);
  document.getElementById("wizard-submit").classList.toggle("hidden", state.wizardStep !== 6);
  if (state.wizardStep >= 6) {
    updateWizardSummary();
  }
  if (state.wizardStep === 5) {
    renderWizardCheckResult(state.wizardCheckReport);
  }
  renderWorkflowStageTracker();
}

function renderCheckOptions(containerId, items, name) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="empty">暂无可选项</div>`;
    return;
  }

  const sortedItems = [...items].sort((a, b) => {
    return (
      Number(Boolean(b.recommendTemplatePromotion)) - Number(Boolean(a.recommendTemplatePromotion)) ||
      Number(String(b.roleLabel || "") === "模板") - Number(String(a.roleLabel || "") === "模板") ||
      Number(b.candidateRuleCount || 0) - Number(a.candidateRuleCount || 0)
    );
  });

  for (const item of sortedItems) {
    const label = document.createElement("label");
    label.className = "check-item check-card";
    const hintChips = [
      item.recommendTemplatePromotion ? "建议转为模板" : "",
      item.isTemplate ? "正式模板" : "",
      !item.isTemplate && String(item.roleLabel || "") === "模板" ? "候选模板" : "",
      Number(item.candidateRuleCount || 0) > 0 ? `候选规则 ${Number(item.candidateRuleCount)} 条` : "",
    ].filter(Boolean);
    label.innerHTML = `
      <input type="checkbox" name="${name}" value="${escapeHtml(item.id)}" />
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="mini">类型：${escapeHtml(item.docType || "-")} / 场景：${escapeHtml(item.scenario || "-")}</span>
        <span class="mini">${escapeHtml(item.roleReason || "会作为历史参考材料参与生成。")}</span>
        ${hintChips.length ? `<span class="mini">${escapeHtml(hintChips.join(" / "))}</span>` : ""}
      </span>
    `;
    container.append(label);
  }
}

function renderTemplateChoiceCards(items, selectedId = "") {
  const container = document.getElementById("template-choice-cards");
  if (!container) {
    return;
  }
  if (!items.length) {
    container.innerHTML = `<div class="empty">暂无模板可选</div>`;
    return;
  }

  container.innerHTML = items
    .slice(0, 3)
    .map((item) => {
      const recommendation = scoreTemplateForCurrentTask(item, getCurrentWizardTemplateSignals());
      const selected = item.id === selectedId;
      return `<button type="button" class="choice-card ${selected ? "active" : ""}" data-action="pick-template-card" data-template-id="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.title || "未命名模板")}</strong>
        <div class="mini">${escapeHtml(item.docType || "-")} / ${escapeHtml(item.scenario || "通用场景")}</div>
        <div class="mini">${escapeHtml(getTemplateKindHint(item))}</div>
        <div class="mini">匹配度 ${escapeHtml(recommendation.score.toFixed(1))}</div>
      </button>`;
    })
    .join("");
}

function renderTemplateSelector(items) {
  const select = document.getElementById("template-selector");
  const currentValue = String(select?.value || "").trim();
  const signals = getCurrentWizardTemplateSignals();
  const sortedItems = [...items].sort((a, b) => {
    const scoreDelta = scoreTemplateForCurrentTask(b, signals).score - scoreTemplateForCurrentTask(a, signals).score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    if (Boolean(b.isTemplate) !== Boolean(a.isTemplate)) {
      return Number(Boolean(b.isTemplate)) - Number(Boolean(a.isTemplate));
    }
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });
  select.innerHTML = `<option value="">不使用模板</option>`;
  for (const item of sortedItems) {
    const option = document.createElement("option");
    option.value = item.id;
    const prefix = item.isTemplate ? "★" : "";
    const suffix = item.isTemplate ? " · 正式模板" : " · 候选模板";
    option.textContent = `${prefix}${item.title}${item.docType ? `（${item.docType}）` : ""}${suffix}`;
    select.append(option);
  }
  if (currentValue) {
    select.value = currentValue;
  }
  renderTemplateChoiceCards(sortedItems, String(select.value || "").trim());
  renderTemplatePreview();
}

function getCurrentWizardTemplateSignals() {
  const form = document.getElementById("wizard-form");
  const formData = form ? new FormData(form) : new FormData();
  return {
    docType: String(formData.get("docType") || "").trim(),
    background: String(formData.get("background") || "").trim(),
    mustInclude: String(formData.get("mustInclude") || "").trim(),
    specialRequirements: String(formData.get("specialRequirements") || "").trim(),
  };
}

function scoreTemplateForCurrentTask(template, signals) {
  let score = 0;
  const reasons = [];
  const templateDocType = String(template?.docType || "").trim();
  const scenario = String(template?.scenario || "").trim();
  const roleLabel = String(template?.roleLabel || "").trim();
  const signalText = `${signals.background} ${signals.mustInclude} ${signals.specialRequirements}`.toLowerCase();

  if (signals.docType && templateDocType && templateDocType === signals.docType) {
    score += 3;
    reasons.push(`文种一致：${templateDocType}`);
  } else if (signals.docType && templateDocType && signals.docType.includes(templateDocType)) {
    score += 2;
    reasons.push(`文种接近：${templateDocType}`);
  }

  if (scenario && signalText && signalText.includes(scenario.toLowerCase())) {
    score += 2;
    reasons.push(`场景贴近：${scenario}`);
  }

  if (roleLabel === "模板") {
    score += 1.5;
    reasons.push("已归类为模板");
  }

  if (Boolean(template?.recommendTemplatePromotion)) {
    score += 1.2;
    reasons.push("系统建议升为模板");
  }

  if (String(template?.quality || "") === "high") {
    score += 1;
    reasons.push("质量较高");
  }

  const candidateRuleCount = Number(template?.candidateRuleCount || 0);
  if (candidateRuleCount >= 2) {
    score += 1;
    reasons.push(`可提炼规则较多：${candidateRuleCount} 条`);
  }

  const structureBlockCount = Number(template?.structureBlockCount || 0);
  if (structureBlockCount >= 3) {
    score += 0.8;
    reasons.push("结构拆解较完整");
  }

  if (!reasons.length) {
    reasons.push("可作为通用结构参考");
  }

  return { score, reasons };
}

function getTemplateKindLabel(item) {
  return item?.isTemplate ? "正式模板" : "候选模板";
}

function getTemplateKindHint(item) {
  if (item?.isTemplate) {
    return "已正式进入模板库，生成时会优先参考它的结构和语气。";
  }
  return "当前仍是候选模板，系统会参考它的结构与表达；如果后续多次复用稳定，建议在设置页转成正式模板。";
}

function renderRecommendationReasonChips(recommendation) {
  const reasons = Array.isArray(recommendation?.reasons) ? recommendation.reasons.slice(0, 4) : [];
  if (!reasons.length) {
    return "";
  }
  return `<div class="inline-chips">${reasons.map((reason) => `<span class="mini-chip">${escapeHtml(reason)}</span>`).join("")}</div>`;
}

function renderTemplateQualityChips(template) {
  const chips = [];
  if (Boolean(template?.isTemplate) || String(template?.roleLabel || "") === "模板") {
    chips.push("正式模板");
  } else if (Boolean(template?.recommendTemplatePromotion) || String(template?.quality || "") === "high") {
    chips.push("候选模板");
  }
  if (String(template?.quality || "") === "high") {
    chips.push("高质量");
  }
  if (Number(template?.candidateRuleCount || 0) > 0) {
    chips.push(`规则提示 ${Number(template.candidateRuleCount)} 条`);
  }
  if (Number(template?.structureBlockCount || 0) > 0) {
    chips.push(`结构块 ${Number(template.structureBlockCount)} 段`);
  }
  if (!chips.length) {
    return "";
  }
  return `<div class="inline-chips">${chips.map((item) => `<span class="mini-chip priority">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderMaterialQualityChips(item) {
  const chips = [];
  if (Boolean(item?.recommendTemplatePromotion)) {
    chips.push("建议转为模板");
  }
  if (String(item?.roleLabel || "") === "模板") {
    chips.push("候选模板");
  }
  if (String(item?.quality || "") === "high") {
    chips.push("高质量");
  }
  if (Number(item?.candidateRuleCount || 0) > 0) {
    chips.push(`候选规则 ${Number(item.candidateRuleCount)} 条`);
  }
  if (Number(item?.structureBlockCount || 0) > 0) {
    chips.push(`结构拆解 ${Number(item.structureBlockCount)} 段`);
  }
  if (!chips.length) {
    return "";
  }
  return `<div class="inline-chips">${chips.map((chip) => `<span class="mini-chip">${escapeHtml(chip)}</span>`).join("")}</div>`;
}

function renderTemplatePreview() {
  const container = document.getElementById("template-preview");
  if (!container) {
    return;
  }

  const templateId = String(document.getElementById("template-selector")?.value || "").trim();
  const templateMode = String(document.querySelector("[name='templateMode']")?.value || "hybrid");
  const templates = Array.isArray(state.dashboard?.templateCandidates)
    ? state.dashboard.templateCandidates
    : Array.isArray(state.dashboard?.templates)
      ? state.dashboard.templates
      : [];
  const signals = getCurrentWizardTemplateSignals();
  const rankedTemplates = templates
    .map((item) => ({
      item,
      recommendation: scoreTemplateForCurrentTask(item, signals),
    }))
    .sort((a, b) => b.recommendation.score - a.recommendation.score);
  const selected = templates.find((item) => item.id === templateId) || null;

  if (!selected) {
    const recommended = rankedTemplates.filter((entry) => entry.recommendation.score > 0).slice(0, 3);
    container.innerHTML = `
      <div>当前不使用模板。系统照样会生成，只是结构会更灵活，更多依赖历史材料、规则库和本次背景。</div>
      <div class="mini">如果你希望它更像你过去常用的写法、段落顺序或固定套路，建议在这里选一个模板。</div>
      ${
        recommended.length
          ? `<div class="template-recommend-list">${recommended
              .map(
                ({ item, recommendation }, index) => {
                  const level =
                    index === 0 || recommendation.score >= 5
                      ? "strong"
                      : recommendation.score >= 3
                        ? "medium"
                        : "light";
                  const levelLabel =
                    level === "strong" ? "优先推荐" : level === "medium" ? "可作为备选" : "仅作参考";
                  return `
                <div class="template-recommend-item ${level}">
                  <strong>推荐 ${index + 1}：${escapeHtml(item.title || "未命名模板")}</strong>
                  <div class="mini"><span class="status-chip ${level === "strong" ? "status-confirmed" : level === "medium" ? "status-candidate" : "status-neutral"}">${levelLabel}</span> / ${escapeHtml(getTemplateKindLabel(item))}</div>
                  ${renderTemplateQualityChips(item)}
                  ${renderRecommendationReasonChips(recommendation)}
                  <div class="mini">${escapeHtml(getTemplateKindHint(item))}</div>
                  <div class="mini">匹配度 ${escapeHtml(recommendation.score.toFixed(1))}</div>
                </div>`;
                },
              )
              .join("")}</div>`
          : `<div class="mini">当前信息还不足以推荐更合适的模板，系统会按常规规则和材料生成。</div>`
      }
    `;
    return;
  }

  const recommendation = scoreTemplateForCurrentTask(selected, signals);
  const recommendationLabel =
    recommendation.score >= 5 ? "优先推荐" : recommendation.score >= 3 ? "可作为备选" : "仅作参考";
  const modeHint =
    templateMode === "strict"
      ? "会尽量按模板原有顺序和结构来写，适合格式非常固定的材料。"
      : templateMode === "light"
        ? "主要借模板的语气和表达方式，结构会更自由。"
        : "会保留模板骨架，同时结合这次的新事实，适合大多数情况。";
  const structure = Array.isArray(selected.structureSummary) ? selected.structureSummary.slice(0, 3) : [];
  const phrases = Array.isArray(selected.usefulPhrases) ? selected.usefulPhrases.slice(0, 2) : [];

  container.innerHTML = `
    <div><strong>${escapeHtml(selected.title || "已选模板")}</strong></div>
    <div class="mini"><span class="status-chip ${recommendation.score >= 5 ? "status-confirmed" : recommendation.score >= 3 ? "status-candidate" : "status-neutral"}">${escapeHtml(recommendationLabel)}</span> / ${escapeHtml(getTemplateKindLabel(selected))}</div>
    ${renderTemplateQualityChips(selected)}
    ${renderRecommendationReasonChips(recommendation)}
    <div class="mini">${escapeHtml(getTemplateKindHint(selected))}</div>
    <div class="mini">更适合：${escapeHtml(selected.docType || "-")} / ${escapeHtml(selected.scenario || "通用场景")} / 质量 ${escapeHtml(selected.quality || "-")}</div>
    <div class="mini">匹配度 ${escapeHtml(recommendation.score.toFixed(1))}</div>
    <div class="mini">这次会这样用：${escapeHtml(modeHint)}</div>
    <div class="mini">常见结构：${escapeHtml(structure.join(" / ") || "暂无结构摘要")}</div>
    <div class="mini">可参考表达：${escapeHtml(phrases.join(" / ") || "暂无表达摘要")}</div>
  `;
}

function renderSimpleList(containerId, items, renderItem) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="empty">${escapeHtml(container.dataset.empty || "暂无数据")}</div>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "row-item";
    row.innerHTML = renderItem(item);
    container.append(row);
  }
}

function renderGroupedRuleList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  const rules = Array.isArray(items) ? items : [];
  if (!rules.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }

  const groups = [
    { key: "confirmed", label: "已确认规则" },
    { key: "candidate", label: "候选规则" },
    { key: "disabled", label: "已停用规则" },
  ];

  container.innerHTML = `<div class="grouped-list">${groups
    .map((group) => {
      const entries = rules
        .filter((item) => item.status === group.key)
        .sort((a, b) => {
          if (group.key === "candidate") {
            return (
              Number(b.linkedFeedbackCount || 0) - Number(a.linkedFeedbackCount || 0) ||
              Number(b.confidence || 0) - Number(a.confidence || 0) ||
              String(b.latestVersionAt || "").localeCompare(String(a.latestVersionAt || ""))
            );
          }
          if (group.key === "confirmed") {
            return (
              Number(b.linkedTaskCount || 0) - Number(a.linkedTaskCount || 0) ||
              String(b.latestVersionAt || "").localeCompare(String(a.latestVersionAt || ""))
            );
          }
          return String(b.latestVersionAt || "").localeCompare(String(a.latestVersionAt || ""));
        });
      if (!entries.length) {
        return "";
      }
      return `<section class="list-group">
        <div class="list-group-head">
          <strong>${escapeHtml(group.label)}</strong>
          <span class="list-group-count">${escapeHtml(String(entries.length))} 条</span>
        </div>
        ${entries
          .map((item) => {
            const docTypes = Array.isArray(item.docTypes) ? item.docTypes.join(", ") : "";
            const audiences = Array.isArray(item.audiences) ? item.audiences.join(", ") : "";
            const sourceTitles = Array.isArray(item.sourceMaterialTitles) ? item.sourceMaterialTitles.slice(0, 3) : [];
            const taskTitles = Array.isArray(item.linkedTaskTitles) ? item.linkedTaskTitles : [];
            const feedbackIds = Array.isArray(item.linkedFeedbackIds) ? item.linkedFeedbackIds : [];
            const priorityHint =
              group.key === "candidate" && Number(item.linkedFeedbackCount || 0) > 0
                ? `<span class="mini-chip priority">建议优先确认</span>`
                : "";
            const scopeLabel = item.scope ? `适用范围：${item.scope}` : "适用范围：通用";
            const docTypeLabel = docTypes || "不限";
            const audienceLabel = audiences || "不限";
            return `<div class="row-item">
              <div class="row-main">
                <strong>${escapeHtml(item.title)}</strong>
                <div class="mini">${escapeHtml(scopeLabel)} / 常见文种：${escapeHtml(docTypeLabel)} / 面向对象：${escapeHtml(audienceLabel)}</div>
                <div class="mini">已沉淀版本 ${escapeHtml(String(item.versionCount ?? 0))} / 置信度 ${escapeHtml(String(item.confidence ?? 0))} / 已影响任务 ${escapeHtml(String(item.linkedTaskCount ?? 0))} 次 / 来自反馈 ${escapeHtml(String(item.linkedFeedbackCount ?? 0))} 次</div>
                <div class="inline-chips">
                  ${priorityHint}
                  ${
                    taskTitles.length
                      ? taskTitles.map((title) => `<span class="mini-chip priority">${escapeHtml(title)}</span>`).join("")
                      : ""
                  }
                  ${
                    feedbackIds.length
                      ? feedbackIds.map((id) => `<span class="mini-chip">${escapeHtml(id)}</span>`).join("")
                      : ""
                  }
                </div>
                <div class="rule-provenance">
                  <div class="mini">来源材料：${escapeHtml(sourceTitles.join(" / ") || "暂无来源记录")}</div>
                  <div class="mini">最近版本：${escapeHtml(item.latestVersionAt || "-")}</div>
                </div>
              </div>
              <div class="row-actions">
                <button type="button" class="mini-btn" data-action="view-rule" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看</button>
                <button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)} 文件路径">复制路径</button>
                <button type="button" class="mini-btn" data-action="rule-set-scope" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">设范围</button>
                <button type="button" class="mini-btn" data-action="rule-view-versions" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">版本</button>
                <button type="button" class="mini-btn" data-action="rule-rollback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">回滚</button>
                <button type="button" class="mini-btn" data-action="rule-confirm" data-path="${escapeHtml(item.path)}">确认</button>
                <button type="button" class="mini-btn" data-action="rule-disable" data-path="${escapeHtml(item.path)}">停用</button>
                <button type="button" class="mini-btn" data-action="rule-reject" data-path="${escapeHtml(item.path)}">拒绝</button>
              </div>
            </div>`;
          })
          .join("")}
      </section>`;
    })
    .join("")}</div>`;
}

function renderGroupedFeedbackList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  const feedbackEntries = Array.isArray(items) ? items : [];
  if (!feedbackEntries.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }

  const groups = new Map();
  feedbackEntries.forEach((item) => {
    const key = item.taskId || "unlinked";
    if (!groups.has(key)) {
      groups.set(key, {
        taskId: item.taskId || "",
        taskTitle: item.taskTitle || item.taskId || "未关联任务",
        entries: [],
      });
    }
    groups.get(key).entries.push(item);
  });

  container.innerHTML = `<div class="grouped-list">${[...groups.values()]
    .map((group) => {
      const entries = [...group.entries].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      return `<section class="list-group">
        <div class="list-group-head">
          <strong>${escapeHtml(group.taskTitle)}</strong>
          <span class="list-group-count">${escapeHtml(String(entries.length))} 条反馈</span>
        </div>
        ${entries
          .map((item) => {
            const relatedRules = Array.isArray(item.relatedRules) ? item.relatedRules.filter(Boolean) : [];
            const ruleTitles = Array.isArray(item.relatedRuleTitles) ? item.relatedRuleTitles.slice(0, 3) : [];
            const candidateRules = Array.isArray(item.relatedRules)
              ? item.relatedRules.filter((rule) => rule && rule.status === "candidate").slice(0, 2)
              : [];
            const confirmedRules = relatedRules.filter((rule) => rule.status === "confirmed");
            const disabledRules = relatedRules.filter((rule) => rule.status === "disabled");
            const reusableText =
              item.reusableSuggestion === true
                ? "建议入规则"
                : item.reusableSuggestion === false
                  ? "更像一次性修改"
                  : "待学习";
            const feedbackTypeLabel =
              item.feedbackType === "structure"
                ? "结构调整"
                : item.feedbackType === "logic"
                  ? "逻辑调整"
                  : item.feedbackType === "missing_info"
                    ? "补充信息"
                    : item.feedbackType === "wording"
                      ? "措辞调整"
                      : item.feedbackType || "-";
            const processStatus =
              confirmedRules.length > 0
                ? "已入规则"
                : candidateRules.length > 0
                  ? "待确认"
                  : disabledRules.length > 0
                    ? "已停用"
                    : "未关联规则";
            return `<div class="row-item">
              <div class="row-main">
                <strong>${escapeHtml(item.id)}</strong>
                <div class="mini">${escapeHtml(feedbackTypeLabel)} / 修改位置：${escapeHtml(item.affectedParagraph || "全文")} / ${escapeHtml(reusableText)}</div>
                <div class="mini">处理状态：<span class="status-chip ${processStatus === "已入规则" ? "status-confirmed" : processStatus === "待确认" ? "status-candidate" : processStatus === "已停用" ? "status-disabled" : "status-neutral"}">${escapeHtml(processStatus)}</span></div>
                <div class="mini">系统建议沉淀为：${escapeHtml(item.candidateRuleTitle || "暂无")} ${item.candidateRuleScope ? `/ ${escapeHtml(item.candidateRuleScope)}` : ""}</div>
                <div class="mini">当前已关联规则：${escapeHtml(ruleTitles.join(" / ") || "暂无")}</div>
                ${
                  relatedRules.length
                    ? `<div class="inline-chips">${relatedRules
                        .slice(0, 4)
                        .map(
                          (rule) =>
                            `<span class="mini-chip ${rule.status === "confirmed" ? "priority" : ""}">${escapeHtml(rule.title)} · ${escapeHtml(rule.status === "confirmed" ? "已确认" : rule.status === "candidate" ? "待确认" : "已停用")}</span>`,
                        )
                        .join("")}</div>`
                    : ""
                }
                <div class="mini">时间：${escapeHtml(item.createdAt || "-")}</div>
              </div>
              <div class="row-actions">
                <button type="button" class="mini-btn" data-action="view-feedback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.id)}">查看</button>
                <button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.id)} 文件路径">复制路径</button>
                <button type="button" class="mini-btn" data-action="learn-feedback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.id)}">学习反馈</button>
                ${candidateRules
                  .map(
                    (rule) =>
                      `<button type="button" class="mini-btn" data-action="feedback-confirm-rule" data-path="${escapeHtml(rule.path)}" data-title="${escapeHtml(rule.title)}">确认规则</button>`,
                  )
                  .join("")}
              </div>
            </div>`;
          })
          .join("")}
      </section>`;
    })
    .join("")}</div>`;
}

function renderProfileList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  const profiles = Array.isArray(items) ? items : [];
  if (!profiles.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }

  container.innerHTML = profiles
    .map((item) => {
      const highlights = [
        ...(Array.isArray(item.highPriorityPreferences) ? item.highPriorityPreferences.slice(0, 2) : []),
        ...(Array.isArray(item.commonTaboos) ? item.commonTaboos.slice(0, 1).map((value) => `禁忌：${value}`) : []),
      ].slice(0, 3);
      const leadership = Array.isArray(item.scenarioGuidance?.leadershipReport)
        ? item.scenarioGuidance.leadershipReport.slice(0, 2)
        : [];
      const generatedByLabel =
        item.generatedBy === "llm"
          ? "LLM 自动总结"
          : item.generatedBy === "fallback"
            ? "本地兜底总结"
            : item.generatedBy || "unknown";
      return `<div class="row-item">
        <div class="row-main">
          <strong>${escapeHtml(item.name)}</strong>
          <div class="mini">版本 ${escapeHtml(String(item.version || 1))} / ${escapeHtml(generatedByLabel)} / ${escapeHtml(item.updatedAt || "-")}</div>
          <div class="mini">这份画像目前主要来自：规则 ${escapeHtml(String(item.sourceStats?.confirmed_rules ?? 0))} / 材料 ${escapeHtml(String(item.sourceStats?.materials ?? 0))} / 反馈 ${escapeHtml(String(item.sourceStats?.feedback_entries ?? 0))}</div>
          <div class="mini">语气：${escapeHtml(item.overview?.tone || "未提炼")} / 结构：${escapeHtml(item.overview?.body || "未提炼")}</div>
          <div class="mini">开头：${escapeHtml(item.overview?.opening || "未提炼")}</div>
          <div class="mini">结尾：${escapeHtml(item.overview?.ending || "未提炼")}</div>
          <div class="rule-provenance">
            <div class="mini">高优先偏好：${escapeHtml(highlights.join(" / ") || "暂无")}</div>
            <div class="mini">领导汇报倾向：${escapeHtml(leadership.join(" / ") || "暂无")}</div>
            <div class="mini">已经比较稳定的习惯：${escapeHtml((item.stableRuleSummary || []).slice(0, 2).join(" / ") || "暂无")}</div>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="mini-btn" data-action="view-profile" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.name)}">查看</button>
          <button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.name)} 文件路径">复制路径</button>
        </div>
      </div>`;
    })
    .join("");
}

function renderObsidianAssetSummary(data) {
  const container = document.getElementById("obsidian-asset-summary");
  const quickActions = document.getElementById("obsidian-quick-actions");
  if (!container) {
    return;
  }

  const materialCount = Array.isArray(data.materials) ? data.materials.length : 0;
  const templateCount = Array.isArray(data.templates) ? data.templates.length : 0;
  const ruleCount = Array.isArray(data.rules) ? data.rules.length : 0;
  const profileCount = Array.isArray(data.profiles) ? data.profiles.length : 0;
  const feedbackCount = Array.isArray(data.feedback) ? data.feedback.length : 0;
  const taskCount = Array.isArray(data.tasks) ? data.tasks.length : 0;
  const vaultRoot = data.vaultRoot || "-";
  const quickPaths = [
    { label: "复制 Vault 根目录", path: vaultRoot },
    { label: "复制材料目录", path: `${vaultRoot}/materials` },
    { label: "复制任务目录", path: `${vaultRoot}/tasks` },
    { label: "复制规则目录", path: `${vaultRoot}/rules` },
    { label: "复制画像目录", path: `${vaultRoot}/profiles` },
    { label: "复制反馈目录", path: `${vaultRoot}/feedback` },
  ];

  container.innerHTML = `
    <strong>当前 Vault 资产分布</strong>
    <div class="mini">Vault：${escapeHtml(vaultRoot)}</div>
    <div class="mini">历史材料 ${escapeHtml(String(materialCount))} 篇 / 正式模板 ${escapeHtml(String(templateCount))} 份 / 任务成稿 ${escapeHtml(String(taskCount))} 份</div>
    <div class="mini">规则 ${escapeHtml(String(ruleCount))} 条 / 画像 ${escapeHtml(String(profileCount))} 份 / 反馈 ${escapeHtml(String(feedbackCount))} 条</div>
    <div class="mini">推荐方式：在 Obsidian 里整理这些资产，在 Growing Writer 里继续分析、生成和学习。</div>
  `;

  if (quickActions) {
    quickActions.innerHTML = quickPaths
      .map(
        (item) =>
          `<button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</button>`,
      )
      .join("");
  }
  const status = document.getElementById("obsidian-quick-action-status");
  if (status && !status.textContent) {
    status.textContent = "可以直接复制这些目录路径，到 Obsidian、Finder 或其他工具里继续使用。";
  }
}

function renderSettingsLists() {
  const data = state.dashboard || {};
  renderObsidianAssetSummary(data);
  const sortedMaterials = [...(data.materials || [])]
    .filter((item) => !item.isTemplate)
    .sort((a, b) => {
    const promotionDelta = Number(Boolean(b.recommendTemplatePromotion)) - Number(Boolean(a.recommendTemplatePromotion));
    if (promotionDelta !== 0) {
      return promotionDelta;
    }
    const roleDelta = Number(String(b.roleLabel || "") === "模板") - Number(String(a.roleLabel || "") === "模板");
    if (roleDelta !== 0) {
      return roleDelta;
    }
    return (
      Number(b.candidateRuleCount || 0) - Number(a.candidateRuleCount || 0) ||
      Number(b.structureBlockCount || 0) - Number(a.structureBlockCount || 0)
    );
    });
  renderSimpleList("settings-materials", sortedMaterials, (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">${escapeHtml(item.roleLabel || "参考材料")} / ${escapeHtml(item.docType || "-")} / ${escapeHtml(item.audience || "-")} / ${escapeHtml(item.quality || "-")}</div>
      <div class="mini">${escapeHtml(item.roleReason || "")}</div>
      ${renderMaterialQualityChips(item)}
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看</button>
      <button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)} 文件路径">复制路径</button>
      <button type="button" class="mini-btn" data-action="analyze-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">重分析</button>
      <button type="button" class="mini-btn" data-action="material-mark-template" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">${item.recommendTemplatePromotion ? "按建议转模板" : "转模板"}</button>
    </div>`;
  });

  const sortedTemplates = [...(data.templates || [])].sort((a, b) => {
    return (
      Number(b.isTemplate) - Number(a.isTemplate) ||
      Number(b.candidateRuleCount || 0) - Number(a.candidateRuleCount || 0) ||
      Number(b.structureBlockCount || 0) - Number(a.structureBlockCount || 0) ||
      String(a.title || "").localeCompare(String(b.title || ""), "zh-CN")
    );
  });
  renderSimpleList("settings-templates", sortedTemplates, (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">${escapeHtml(item.roleLabel || "模板")} / ${escapeHtml(item.docType || "-")} / ${escapeHtml(item.scenario || "-")}</div>
      <div class="mini">${escapeHtml(normalizeTemplateUiCopy(item.roleReason || "正式模板会优先参与生成。"))}</div>
      ${renderTemplateQualityChips(item)}
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看模板</button>
      <button type="button" class="mini-btn" data-action="copy-path" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)} 文件路径">复制路径</button>
      <button type="button" class="mini-btn" data-action="material-mark-history" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">转历史材料</button>
    </div>`;
  });

  renderGroupedRuleList("settings-rules", data.rules || []);

  renderProfileList("settings-profiles", data.profiles || []);

  renderGroupedFeedbackList("settings-feedback", data.feedback || []);

  renderSimpleList("settings-workflows", data.workflowRuns || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title || item.taskId || item.runId)}</strong>
      <div class="mini">Run ${escapeHtml(item.runId)} / ${escapeHtml(item.status)} / ${escapeHtml(item.currentStage)} / ${escapeHtml(item.updatedAt || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-workflow" data-runid="${escapeHtml(item.runId)}" data-title="${escapeHtml(item.title || item.runId)}">查看事件</button>
    </div>`;
  });

  renderSimpleList("settings-observability", data.observability || [], (item) => {
    const modelDetail = [item.usedModel || "-", ...(item.triedModels || [])]
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .join(" -> ");
    return `<div class="row-main">
      <strong>${escapeHtml(item.stage || "-")} / ${escapeHtml(item.taskId || "-")}</strong>
      <div class="mini">${escapeHtml(item.at || "-")} / model=${escapeHtml(modelDetail || "-")} / ${escapeHtml(String(item.durationMs || 0))}ms / success=${escapeHtml(String(item.success))} / rules=${escapeHtml(String(item.matchedRuleCount || 0))}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-observability" data-obid="${escapeHtml(item.id || "")}">查看</button>
    </div>`;
  });

  const workflowMeta = data.workflowDefinition;
  if (workflowMeta) {
    const container = document.getElementById("settings-workflows");
    const summary = document.createElement("div");
    summary.className = "row-item";
    summary.innerHTML = `<div class="row-main">
      <strong>DSL：${escapeHtml(workflowMeta.id || "-")} v${escapeHtml(String(workflowMeta.version || "-"))}</strong>
      <div class="mini">source=${escapeHtml(workflowMeta.source || "-")} / stage=${escapeHtml(String(workflowMeta.stageCount || 0))} / initial=${escapeHtml(workflowMeta.initialStage || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-workflow-definition">查看 DSL</button>
    </div>`;
    container.prepend(summary);
  }
}

function applyMaterialRoleUpdate(result) {
  if (!state.dashboard || !result?.path) {
    return;
  }

  const allItems = [...(state.dashboard.materials || []), ...(state.dashboard.templates || [])];
  const itemByPath = new Map(allItems.map((item) => [item.path, item]));
  const target = itemByPath.get(result.path);
  if (!target) {
    return;
  }

  const updatedTarget = {
    ...target,
    isTemplate: Boolean(result.isTemplate),
    roleLabel: result.roleLabel || target.roleLabel,
    roleReason: result.roleReason || target.roleReason,
    recommendTemplatePromotion: Boolean(result.recommendTemplatePromotion),
  };
  itemByPath.set(result.path, updatedTarget);
  const updatedAllItems = [...itemByPath.values()].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"));

  state.dashboard = {
    ...state.dashboard,
    materials: updatedAllItems.filter((item) => !item.isTemplate),
    templates: updatedAllItems.filter((item) => item.isTemplate),
    templateCandidates: updatedAllItems.filter(
      (item) => item.isTemplate || item.recommendTemplatePromotion || item.quality === "high",
    ),
  };

  renderTemplateSelector(state.dashboard.templateCandidates || state.dashboard.templates || []);
  renderCheckOptions(
    "wizard-material-options",
    (state.dashboard.materials || []).filter((item) => !item.isTemplate),
    "sourceMaterialIds",
  );
  renderSettingsLists();
}

function toggleLlmMode(mode) {
  const isOauth = mode === "openai-codex-oauth";
  document.getElementById("oauth-config").classList.toggle("hidden", !isOauth);
  document.getElementById("key-config").classList.toggle("hidden", isOauth);
  document.getElementById("llm-api-type-wrap").classList.toggle("hidden", isOauth);
  document.getElementById("llm-model-oauth-wrap").classList.toggle("hidden", !isOauth);
  document.getElementById("llm-model-key-wrap").classList.toggle("hidden", isOauth);
  if (isOauth && !document.getElementById("llm-model-oauth-select").value) {
    document.getElementById("llm-model-oauth-select").value = "gpt-5.4";
  }
}

function renderValidationMessages(validation, options = {}) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  if (!errors.length && !warnings.length) {
    return options.emptyText ? `<div class="mini">${escapeHtml(options.emptyText)}</div>` : "";
  }

  const items = [
    ...errors.map((item) => ({ level: "error", text: item })),
    ...warnings.map((item) => ({ level: "warn", text: item })),
  ];
  return `<div class="validation-list">
    ${items
      .map(
        (item) =>
          `<div class="validation-item ${item.level}">${escapeHtml(item.text)}</div>`,
      )
      .join("")}
  </div>`;
}

function setLlmValidationFeedback(validation, message = "") {
  const container = document.getElementById("llm-validation-feedback");
  if (!container) {
    return;
  }

  const hasErrors = Array.isArray(validation?.errors) && validation.errors.length > 0;
  const hasWarnings = Array.isArray(validation?.warnings) && validation.warnings.length > 0;
  const hasMessages = hasErrors || hasWarnings || Boolean(message);
  container.classList.toggle("hidden", !hasMessages);
  if (!hasMessages) {
    container.innerHTML = "";
    return;
  }

  const messageHtml = message ? `<div class="msg">${escapeHtml(message)}</div>` : "";
  container.innerHTML = `${messageHtml}${renderValidationMessages(validation)}`;
}

function setLlmModalOpen(open) {
  document.getElementById("llm-editor-modal").classList.toggle("hidden", !open);
}

function getLlmFormPayload() {
  const mode = document.getElementById("llm-mode").value;
  const model =
    mode === "openai-codex-oauth"
      ? document.getElementById("llm-model-oauth-select").value
      : document.getElementById("llm-model-key-input").value.trim();
  return {
    profileId: state.editingLlmProfileId || undefined,
    name: document.getElementById("llm-card-name-input").value.trim(),
    provider: mode,
    apiType:
      mode === "openai-codex-oauth"
        ? "openai-completions"
        : document.getElementById("llm-api-type-select").value,
    model,
    bearerToken:
      mode === "openai-codex-oauth"
        ? ""
        : document.getElementById("llm-token-input").value.trim(),
    baseUrl: document.getElementById("llm-base-url-input").value.trim(),
    authUrl: document.getElementById("llm-auth-url-input").value.trim(),
    routingEnabled: document.getElementById("routing-enabled").checked,
    fastModel: document.getElementById("routing-fast-model").value.trim(),
    strongModel: document.getElementById("routing-strong-model").value.trim(),
    fallbackModels: document
      .getElementById("routing-fallback-models")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function renderFeedbackHistory() {
  const container = document.getElementById("feedback-history");
  if (!state.feedbackHistory.length) {
    container.innerHTML = `<div class="empty">还没有反馈记录，先改一轮正文再提交。</div>`;
    return;
  }

  const latestRows = Object.values(state.latestFeedbackByLocation)
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.location)}</strong>：${escapeHtml(item.reason || "未填原因")}（最新版本 ${escapeHtml(item.version || "-")} / 吸收评分 ${escapeHtml(String(item.absorptionScore ?? "-"))} / 批注 ${escapeHtml(String(item.annotationCount ?? 0))} 条）</li>`,
    )
    .join("");

  const allRows = [...state.feedbackHistory]
    .reverse()
    .map(
      (item) => `<li>
        <div><strong>${escapeHtml(item.version || "-")}</strong> ${escapeHtml(item.createdAt || "")}</div>
        <div>位置：${escapeHtml(item.location)}</div>
        <div>原因：${escapeHtml(item.reason || "-")}</div>
        <div>批注条数：${escapeHtml(String(item.annotationCount ?? 0))}</div>
        <div>吸收评分：${escapeHtml(String(item.absorptionScore ?? "-"))}（${escapeHtml(item.absorptionLevel || "-")}）</div>
        <div class="mini">${escapeHtml(item.comment || "")}</div>
      </li>`,
    )
    .join("");

  container.innerHTML = `
    <div class="history-block">
      <h4>最新权重（每个位置取最后一次）</h4>
      <ul>${latestRows || "<li>无</li>"}</ul>
    </div>
    <div class="history-block">
      <h4>完整修改过程</h4>
      <ul>${allRows}</ul>
    </div>
  `;
}

function setEditorVisible(visible) {
  document.getElementById("editor-panel").classList.toggle("hidden", !visible);
}

function updateSelectionPreview(selection) {
  const preview = document.getElementById("selection-preview");
  const editor = document.getElementById("draft-editor");
  if (!preview) {
    return;
  }
  if (!selection || !selection.text) {
    const cursor = Number(editor?.selectionStart ?? 0);
    const value = String(editor?.value || "");
    const lineIndex = value.slice(0, cursor).split(/\r?\n/).length;
    const currentLine = value.split(/\r?\n/)[Math.max(0, lineIndex - 1)] || "";
    const compact = currentLine.replace(/\s+/g, " ").trim();
    if (!value.trim()) {
      preview.textContent = "当前还没有正文内容。生成初稿后，这里会显示你正在修改的位置。";
    } else {
      preview.textContent = `当前光标大约在第 ${lineIndex} 行：${compact || "这一行暂时为空。"}`;
    }
    preview.classList.remove("has-selection");
    return;
  }
  const compact = selection.text.replace(/\s+/g, " ").trim();
  const text = compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
  preview.textContent = `已选区 [${selection.start}-${selection.end}]：${text}`;
  preview.classList.add("has-selection");
}

function clearFeedbackInputs() {
  document.getElementById("feedback-location").value = "";
  document.getElementById("feedback-reason").value = "";
  document.getElementById("feedback-comment").value = "";
}

function syncActiveAnnotationFromSelection(selection) {
  if (!selection) {
    return;
  }
  const matchIndex = state.pendingAnnotations.findIndex(
    (item) =>
      item?.selection &&
      Number(item.selection.start) === Number(selection.start) &&
      Number(item.selection.end) === Number(selection.end),
  );
  if (matchIndex < 0 || matchIndex === state.activeAnnotationIndex) {
    return;
  }
  state.activeAnnotationIndex = matchIndex;
  refillAnnotationForm(state.pendingAnnotations[matchIndex]);
  renderPendingAnnotations();
}

function summarizeDraftChanges() {
  const baseline = String(state.generatedDraftBaseline || "");
  const current = String(document.getElementById("draft-editor")?.value || "");
  const container = document.getElementById("draft-change-summary");
  if (!container) {
    return;
  }
  if (!baseline.trim() && !current.trim()) {
    container.textContent = "生成初稿后会显示改动摘要。";
    return;
  }

  const baselineLines = baseline.split(/\r?\n/);
  const currentLines = current.split(/\r?\n/);
  const changedLineCount = Math.max(baselineLines.length, currentLines.length)
    ? baselineLines.reduce((count, line, index) => {
        return count + (line !== (currentLines[index] ?? "") ? 1 : 0);
      }, 0) + Math.max(0, currentLines.length - baselineLines.length)
    : 0;
  const charDelta = current.length - baseline.length;
  const summary = [
    `基线长度：${baseline.length} 字`,
    `当前长度：${current.length} 字`,
    `字数变化：${charDelta >= 0 ? "+" : ""}${charDelta}`,
    `变化行数：约 ${changedLineCount} 行`,
    `本轮批注：${state.pendingAnnotations.length} 条`,
    `长期偏好：${state.pendingAnnotations.filter((item) => item.isReusable).length} 条`,
  ];
  container.innerHTML = summary.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
}

function renderAnnotationSubmissionSummary() {
  const container = document.getElementById("annotation-submit-summary");
  if (!container) {
    return;
  }
  if (!state.pendingAnnotations.length) {
    container.textContent = "还没有需要提交的批注。";
    return;
  }

  const topItems = state.pendingAnnotations.slice(0, 3).map((item, index) => {
    const mode = item.isReusable ? "长期偏好" : "本次修改";
    const reason = item.reason || item.comment || "未填写原因";
    return `${index + 1}. ${item.location || `批注 ${index + 1}`} / ${mode} / ${reason}`;
  });
  const remaining = state.pendingAnnotations.length - topItems.length;
  const highPriorityCount = state.pendingAnnotations.filter((item) => item.priority === "high").length;

  container.innerHTML = `
    <div class="mini">将按当前顺序提交 ${escapeHtml(String(state.pendingAnnotations.length))} 条批注，其中高优先级 ${escapeHtml(String(highPriorityCount))} 条。</div>
    <div class="annotation-submit-lines">
      ${topItems.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
      ${remaining > 0 ? `<div class="mini">还有 ${escapeHtml(String(remaining))} 条会一并提交。</div>` : ""}
    </div>
  `;
}

function renderPendingAnnotations() {
  const container = document.getElementById("annotation-list");
  const counter = document.getElementById("annotation-count");
  const lastAdded = document.getElementById("annotation-last-added");
  if (!container) {
    return;
  }
  if (counter) {
    counter.textContent = `${state.pendingAnnotations.length} 条`;
  }
  if (!state.pendingAnnotations.length) {
    container.innerHTML = `<div class="annotation-empty">还没有加入本轮批注。先在正文里选中一段，再写修改原因或批注说明。</div>`;
    if (lastAdded) {
      lastAdded.textContent = "还没有加入本轮批注。";
    }
    state.activeAnnotationIndex = -1;
    summarizeDraftChanges();
    renderAnnotationSubmissionSummary();
    return;
  }

  if (state.activeAnnotationIndex < 0 || state.activeAnnotationIndex >= state.pendingAnnotations.length) {
    state.activeAnnotationIndex = state.pendingAnnotations.length - 1;
  }
  const latest = state.pendingAnnotations[state.pendingAnnotations.length - 1];
  container.innerHTML = state.pendingAnnotations
    .map(
      (item, index) => `<div class="annotation-item ${index === state.pendingAnnotations.length - 1 ? "newest" : ""} ${index === state.activeAnnotationIndex ? "active" : ""}" data-action="select-annotation" data-index="${index}">
        <div class="annotation-head">
          <strong>${escapeHtml(item.location || `批注 ${index + 1}`)}</strong>
          <div class="annotation-head-actions">
            <button type="button" class="mini-btn" data-action="annotation-up" data-index="${index}" ${index === 0 ? "disabled" : ""}>上移</button>
            <button type="button" class="mini-btn" data-action="annotation-down" data-index="${index}" ${index === state.pendingAnnotations.length - 1 ? "disabled" : ""}>下移</button>
            <button type="button" class="mini-btn" data-action="edit-annotation" data-index="${index}">回填</button>
            <button type="button" class="mini-btn" data-action="focus-annotation" data-index="${index}">定位</button>
            <button type="button" class="mini-btn danger" data-action="remove-annotation" data-index="${index}">删除</button>
          </div>
        </div>
        <div class="annotation-controls">
          <label class="inline-check mini">
            <input type="checkbox" data-action="annotation-toggle-reusable" data-index="${index}" ${item.isReusable ? "checked" : ""} />
            <span>${item.isReusable ? "长期偏好" : "本次修改"}</span>
          </label>
          <label class="mini">优先级
            <select data-action="annotation-priority" data-index="${index}">
              <option value="high" ${item.priority === "high" ? "selected" : ""}>高</option>
              <option value="medium" ${item.priority === "medium" ? "selected" : ""}>中</option>
              <option value="low" ${item.priority === "low" ? "selected" : ""}>低</option>
            </select>
          </label>
        </div>
        <div class="mini">原因：${escapeHtml(item.reason || "未填写")}</div>
        <div class="mini">说明：${escapeHtml(item.comment || "未填写")}</div>
        <div class="mini">选区：${escapeHtml(item.selection ? `${item.selection.start}-${item.selection.end}` : "未选择")}</div>
        ${
          item.selection?.text
            ? `<div class="annotation-text">${escapeHtml(item.selection.text)}</div>`
            : ""
        }
      </div>`,
    )
    .join("");
  if (lastAdded) {
    const active = state.pendingAnnotations[state.activeAnnotationIndex];
    lastAdded.innerHTML = `<strong>刚加入本轮批注：</strong><div class="mini">${escapeHtml(latest.location || "未命名位置")} / ${escapeHtml(latest.reason || latest.comment || "未填写原因")}</div>
      <div class="mini">当前正在编辑：${escapeHtml(active?.location || "未命名位置")}</div>`;
  }
  summarizeDraftChanges();
  renderAnnotationSubmissionSummary();
  if (!state.latestFeedbackLearnResult?.analysis) {
    renderFeedbackLearnResult();
  }
}

function refillAnnotationForm(annotation) {
  if (!annotation) {
    return;
  }
  document.getElementById("feedback-location").value = annotation.location || "";
  document.getElementById("feedback-reason").value = annotation.reason || "";
  document.getElementById("feedback-comment").value = annotation.comment || "";
  state.feedbackSelection = annotation.selection || null;
  updateSelectionPreview(annotation.selection || null);
}

function focusAnnotationInDraft(annotation) {
  const editor = document.getElementById("draft-editor");
  const selection = annotation?.selection;
  if (!editor || !selection || !Number.isFinite(selection.start) || !Number.isFinite(selection.end)) {
    throw new Error("这条批注没有记录可定位的正文选区。");
  }
  editor.focus();
  editor.setSelectionRange(selection.start, selection.end);
  state.feedbackSelection = selection;
  updateSelectionPreview(selection);
}

function renderFeedbackLearnResult() {
  const container = document.getElementById("feedback-learn-result");
  if (!container) {
    return;
  }
  const result = state.latestFeedbackLearnResult;
  if (!result?.analysis) {
    if (!state.pendingAnnotations.length) {
      container.textContent = "提交反馈并再次生成后，这里会显示系统对本轮修改的学习结论。";
      return;
    }

    const reusableCount = state.pendingAnnotations.filter((item) => item.isReusable).length;
    const highPriorityCount = state.pendingAnnotations.filter((item) => item.priority === "high").length;
    const likelyFocus = reusableCount
      ? "这轮里有一部分被标记为长期偏好，系统更可能尝试沉淀成规则。"
      : "这轮更像针对当前稿件的局部改写，系统会优先按一次性修改吸收。";
    const structureBias = state.pendingAnnotations.some((item) =>
      /结构|顺序|层次|开头|结尾|先写|后写/.test(`${item.location} ${item.reason} ${item.comment}`),
    )
      ? "其中包含结构类信号，后续学习结果里更可能出现段落顺序或组织方式建议。"
      : "目前更多是措辞、补事实和表达强弱的调整信号。";

    container.innerHTML = `<div class="learn-result">
      <div class="learn-result-grid">
        <div class="learn-result-item"><strong>提交前预判：</strong>${escapeHtml(likelyFocus)}</div>
        <div class="learn-result-item"><strong>结构倾向：</strong>${escapeHtml(structureBias)}</div>
        <div class="learn-result-item"><strong>长期偏好：</strong>${escapeHtml(String(reusableCount))} 条</div>
        <div class="learn-result-item"><strong>高优先级：</strong>${escapeHtml(String(highPriorityCount))} 条</div>
      </div>
    </div>`;
    return;
  }

  const analysis = result.analysis;
  const reusableText = analysis.is_reusable_rule ? "建议入规则" : "更像一次性修改";
  const candidateRule = result.candidateRulePath
    ? `<div class="editor-actions">
        <button type="button" class="btn primary" data-action="confirm-generated-rule" data-path="${escapeHtml(result.candidateRulePath)}">确认入规则</button>
        <button type="button" class="btn ghost" data-action="reject-generated-rule" data-path="${escapeHtml(result.candidateRulePath)}">暂不入库</button>
      </div>`
    : "";

  container.innerHTML = `<div class="learn-result">
    <div class="learn-result-grid">
      <div class="learn-result-item"><strong>反馈类型：</strong>${escapeHtml(analysis.feedback_type || "-")}</div>
      <div class="learn-result-item"><strong>系统判断：</strong>${escapeHtml(reusableText)}</div>
      <div class="learn-result-item"><strong>修改建议：</strong>${escapeHtml(analysis.suggested_update || "-")}</div>
      <div class="learn-result-item"><strong>判断原因：</strong>${escapeHtml(analysis.reasoning || "-")}</div>
      ${
        analysis.candidate_rule
          ? `<div class="learn-result-item"><strong>候选规则：</strong>${escapeHtml(analysis.candidate_rule.title || "-")}<br /><span class="mini">${escapeHtml(analysis.candidate_rule.content || "")}</span></div>`
          : ""
      }
    </div>
    ${candidateRule}
  </div>`;
}

function buildGenerationContextFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const matchedRules = Array.isArray(payload.matchedRules) ? payload.matchedRules : [];
  const matchedMaterials = Array.isArray(payload.matchedMaterials) ? payload.matchedMaterials : [];
  const ruleDecisionLog = Array.isArray(payload.ruleDecisionLog) ? payload.ruleDecisionLog : [];
  const modelRouting = Array.isArray(payload.modelRouting) ? payload.modelRouting : [];
  const templateRule = matchedRules.find((item) => String(item?.source || "") === "template") || null;
  const templateMaterial =
    matchedMaterials.find(
      (item) => Array.isArray(item?.tags) && item.tags.some((tag) => /template|模板/i.test(String(tag))),
    ) ||
    matchedMaterials.find((item) => /template|模板/i.test(String(item?.docType || ""))) ||
    null;

  return {
    matchedRules,
    matchedMaterials,
    ruleDecisionLog,
    modelRouting,
    templateRule,
    templateMaterial,
  };
}

function renderTaskContextSummary() {
  const container = document.getElementById("task-context-summary");
  if (!container) {
    return;
  }

  const context = state.currentGenerationContext;
  if (!context) {
    container.textContent = "生成后会显示本次命中的模板、规则和参考材料。";
    return;
  }

  const templateTitle = context.templateMaterial?.title || context.templateRule?.title || "未启用模板";
  const templateReason = context.templateRule?.reason || "本次按常规规则与材料匹配生成。";
  const topRules = context.matchedRules
    .filter((item) => String(item?.source || "") !== "template")
    .slice(0, 4);
  const templateRules = context.matchedRules.filter((item) => String(item?.source || "") === "template");
  const templateOverrides = context.matchedRules
    .filter((item) => String(item?.source || "") === "template" && /template-override:/.test(String(item?.rule_id || "")))
    .slice(0, 3);
  const topMaterials = context.matchedMaterials
    .filter((item) => item?.id !== context.templateMaterial?.id)
    .slice(0, 3);
  const effectiveScores = context.matchedRules
    .map((item) => Number(item?.effective_score || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const strongestRuleScore = effectiveScores.length ? Math.max(...effectiveScores) : 0;
  const priorityMode = context.templateRule?.title?.match(/\(([^)]+)\)/)?.[1] || "";
  const hierarchyItems = [
    context.templateRule
      ? `模板主导${priorityMode ? `（${priorityMode}）` : ""}：${templateTitle}`
      : "未启用模板主导层",
    topRules.length ? `规则补充：命中 ${topRules.length} 条高优先规则` : "规则补充：未命中额外高优先规则",
    topMaterials.length ? `材料兜底：参考 ${topMaterials.length} 份背景材料` : "材料兜底：主要依赖任务输入",
  ];
  const dominanceSummary = context.templateRule
    ? strongestRuleScore >= 2.1
      ? "本次由模板结构优先定调，规则和材料主要负责补充约束。"
      : "本次模板只做轻量约束，正文更多依赖规则匹配和背景材料。"
    : topRules.length
      ? "本次没有指定模板，正文主要由已确认规则和背景材料共同驱动。"
      : "本次主要依赖任务输入与背景材料生成。";
  const routeSummary = context.modelRouting.length
    ? context.modelRouting.map((item) => `${item.stage}: ${item.usedModel || "-"}`)
    : ["本次未记录模型路由"];
  const decisionTail = context.ruleDecisionLog.slice(-3);

  container.innerHTML = `<div class="context-summary">
    <div class="context-summary-grid">
      <div class="context-card">
        <strong>模板继承</strong>
        <div>${escapeHtml(templateTitle)}</div>
        <div class="mini">${escapeHtml(templateReason)}</div>
        ${
          templateOverrides.length
            ? `<div class="mini">模板加注：${escapeHtml(
                templateOverrides.map((item) => item.reason || item.title || "-").join(" / "),
              )}</div>`
            : ""
        }
      </div>
      <div class="context-card context-card-emphasis">
        <strong>优先级关系</strong>
        <div class="mini">${escapeHtml(dominanceSummary)}</div>
        <ul>
          ${hierarchyItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <div class="mini">模板规则 ${escapeHtml(String(templateRules.length))} 条 / 常规规则 ${escapeHtml(String(topRules.length))} 条 / 最高命中分 ${escapeHtml(strongestRuleScore ? strongestRuleScore.toFixed(2) : "0")}</div>
      </div>
      <div class="context-card">
        <strong>高优先规则</strong>
        <ul>
          ${
            topRules.length
              ? topRules
                  .map(
                    (item) =>
                      `<li><strong>${escapeHtml(item.title || "-")}</strong><br /><span class="mini">${escapeHtml(item.reason || "按规则匹配命中")}</span></li>`,
                  )
                  .join("")
              : "<li>本次未命中额外高优先规则</li>"
          }
        </ul>
      </div>
      <div class="context-card">
        <strong>参考材料</strong>
        <ul>
          ${
            topMaterials.length
              ? topMaterials
                  .map(
                    (item) =>
                      `<li><strong>${escapeHtml(item.title || "-")}</strong><br /><span class="mini">${escapeHtml(item.docType || "背景材料")} / ${escapeHtml(item.audience || "未限定")}</span></li>`,
                  )
                  .join("")
              : "<li>仅使用当前任务输入与模板</li>"
          }
        </ul>
      </div>
      <div class="context-card">
        <strong>模型路由</strong>
        <ul>${routeSummary.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul>
      </div>
    </div>
    <div class="context-log">
      ${
        decisionTail.length
          ? decisionTail.map((item) => `<div class="context-log-item">${escapeHtml(item)}</div>`).join("")
          : `<div class="context-log-item">本次未记录额外裁决日志。</div>`
      }
    </div>
  </div>`;
}

function collectCurrentAnnotation({ strictSelection = true, persist = false } = {}) {
  const location = normalizeLocation(document.getElementById("feedback-location").value);
  const reason = String(document.getElementById("feedback-reason").value || "").trim();
  const comment = String(document.getElementById("feedback-comment").value || "").trim();
  const selection = captureDraftSelection({ strict: strictSelection });
  if (!reason && !comment) {
    throw new Error("请至少填写“修改原因”或“批注说明”。");
  }

  const annotation = {
    location,
    reason,
    comment,
    selection,
    isReusable: /长期|规则|以后都|一律|默认/.test(`${location} ${reason} ${comment}`),
    priority: /必须|一定|重点|优先|严重/.test(`${location} ${reason} ${comment}`) ? "high" : "medium",
    createdAt: new Date().toISOString(),
  };

  if (persist) {
    state.pendingAnnotations.push(annotation);
    state.activeAnnotationIndex = state.pendingAnnotations.length - 1;
    renderPendingAnnotations();
    clearFeedbackInputs();
    state.feedbackSelection = null;
    updateSelectionPreview(null);
  }
  return annotation;
}

function captureDraftSelection(options = { strict: false }) {
  const editor = document.getElementById("draft-editor");
  const start = Number(editor?.selectionStart ?? 0);
  const end = Number(editor?.selectionEnd ?? 0);
  const selected = String(editor?.value || "").slice(start, end).trim();
  if (!selected) {
    if (options.strict) {
      throw new Error("请先在正文中选中需要批注的句子或段落。");
    }
    state.feedbackSelection = null;
    updateSelectionPreview(null);
    return null;
  }

  const selection = { start, end, text: selected };
  state.feedbackSelection = selection;
  const locationInput = document.getElementById("feedback-location");
  if (locationInput && !String(locationInput.value || "").trim()) {
    locationInput.value = `正文[${start}-${end}]`;
  }
  syncActiveAnnotationFromSelection(selection);
  updateSelectionPreview(selection);
  return selection;
}

function normalizeWorkflowDefinitionLite(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const definition = {
    id: String(raw.id || ""),
    version: Number(raw.version || 0),
    initialStage: String(raw.initialStage || ""),
    stages: Array.isArray(raw.stages)
      ? raw.stages.map((item) => ({
          id: String(item?.id || ""),
          label: String(item?.label || ""),
          description: String(item?.description || ""),
          next: Array.isArray(item?.next) ? item.next.map(String) : [],
          actions:
            item?.actions && typeof item.actions === "object" && !Array.isArray(item.actions)
              ? Object.fromEntries(Object.entries(item.actions).map(([k, v]) => [String(k), String(v)]))
              : {},
        }))
      : [],
  };
  return definition;
}

function ensureWorkflowDefinition(raw) {
  const normalized = normalizeWorkflowDefinitionLite(raw);
  if (!normalized) {
    return {
      id: "",
      version: 1,
      initialStage: "",
      stages: [],
    };
  }
  return {
    ...normalized,
    version: Number.isFinite(normalized.version) && normalized.version > 0 ? Math.floor(normalized.version) : 1,
  };
}

function safeParseWorkflowEditorValue() {
  const editor = document.getElementById("workflow-definition-editor");
  const raw = String(editor?.value || "").trim();
  if (!raw) {
    return { definition: ensureWorkflowDefinition(null), error: "DSL 为空。" };
  }
  try {
    const parsed = JSON.parse(raw);
    return { definition: ensureWorkflowDefinition(parsed), error: "" };
  } catch (error) {
    return { definition: null, error: error.message || "JSON 解析失败。" };
  }
}

function formatActionsForEditor(actions) {
  return Object.entries(actions || {})
    .map(([action, target]) => `${action}=${target}`)
    .join("\n");
}

function parseActionsFromEditor(value) {
  const entries = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
      if (separatorIndex < 0) {
        return ["", ""];
      }
      const action = String(line.slice(0, separatorIndex)).trim();
      const target = String(line.slice(separatorIndex + 1)).trim();
      return [action, target];
    })
    .filter(([action, target]) => action && target);
  return Object.fromEntries(entries);
}

function parseTargetsCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createUniqueStageId(definition, seed = "stage") {
  const used = new Set((definition.stages || []).map((stage) => stage.id).filter(Boolean));
  let index = 1;
  let candidate = `${seed}_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${seed}_${index}`;
  }
  return candidate;
}

function applyWorkflowDefinitionToEditor(definition, options = {}) {
  const { skipEditorWrite = false } = options;
  const normalized = ensureWorkflowDefinition(definition);
  state.workflowEditorDefinition = normalized;

  if (!skipEditorWrite) {
    const editor = document.getElementById("workflow-definition-editor");
    if (editor) {
      editor.value = JSON.stringify(normalized, null, 2);
    }
  }

  renderWorkflowGraph(normalized);
  renderWorkflowStageEditor(normalized);
}

function renderWorkflowStageEditor(definition, parseError = "") {
  const list = document.getElementById("workflow-stage-list");
  const metaId = document.getElementById("wf-meta-id");
  const metaVersion = document.getElementById("wf-meta-version");
  const metaInitial = document.getElementById("wf-meta-initial");
  if (!list || !metaId || !metaVersion || !metaInitial) {
    return;
  }

  if (parseError) {
    metaId.value = "";
    metaVersion.value = "";
    metaInitial.innerHTML = '<option value="">无法编辑（DSL 解析失败）</option>';
    list.innerHTML = `<div class="msg error">${escapeHtml(parseError)}</div>`;
    return;
  }

  const normalized = ensureWorkflowDefinition(definition);
  const stageOptions = normalized.stages
    .map((stage) => `<option value="${escapeHtml(stage.id)}"${stage.id === normalized.initialStage ? " selected" : ""}>${escapeHtml(stage.label || stage.id || "(未命名阶段)")}</option>`)
    .join("");

  metaId.value = normalized.id || "";
  metaVersion.value = String(normalized.version || 1);
  metaInitial.innerHTML =
    `<option value="">请选择初始阶段</option>${stageOptions}`;

  if (!normalized.stages.length) {
    list.innerHTML = `<div class="empty">还没有阶段，点击“新增阶段”开始。</div>`;
    return;
  }

  list.innerHTML = normalized.stages
    .map((stage, index) => {
      const isInitial = stage.id && stage.id === normalized.initialStage;
      return `<div class="workflow-stage-card" data-stage-index="${index}">
        <div class="workflow-stage-head">
          <strong>${index + 1}. ${escapeHtml(stage.label || stage.id || "未命名阶段")}${isInitial ? "（初始）" : ""}</strong>
          <div class="workflow-stage-actions">
            <button type="button" class="mini-btn" data-action="stage-up" data-index="${index}" ${index === 0 ? "disabled" : ""}>上移</button>
            <button type="button" class="mini-btn" data-action="stage-down" data-index="${index}" ${index === normalized.stages.length - 1 ? "disabled" : ""}>下移</button>
            <button type="button" class="mini-btn" data-action="stage-initial" data-index="${index}">设为初始</button>
            <button type="button" class="mini-btn" data-action="stage-delete" data-index="${index}">删除</button>
          </div>
        </div>
        <div class="workflow-stage-grid">
          <label>阶段 ID<input type="text" data-field="id" data-index="${index}" value="${escapeHtml(stage.id || "")}" /></label>
          <label>标题<input type="text" data-field="label" data-index="${index}" value="${escapeHtml(stage.label || "")}" /></label>
          <label class="full">描述<textarea data-field="description" data-index="${index}">${escapeHtml(stage.description || "")}</textarea></label>
          <label class="full">next（逗号分隔）<input type="text" data-field="next" data-index="${index}" value="${escapeHtml((stage.next || []).join(", "))}" placeholder="例如：confirm_rules,compose" /></label>
          <label class="full">actions（每行 action=target）<textarea data-field="actions" data-index="${index}" placeholder="approve=confirm_rules&#10;retry=collect_materials">${escapeHtml(formatActionsForEditor(stage.actions || {}))}</textarea></label>
        </div>
      </div>`;
    })
    .join("");
}

function renderWorkflowGraph(definition, parseError = "") {
  const graph = document.getElementById("workflow-graph");
  const hints = document.getElementById("workflow-graph-hints");
  if (!graph || !hints) {
    return;
  }

  if (parseError) {
    graph.innerHTML = `<div class="empty">DSL 解析失败，无法预览。</div>`;
    hints.innerHTML = `<div class="msg error">${escapeHtml(parseError)}</div>`;
    return;
  }

  const normalized = normalizeWorkflowDefinitionLite(definition);
  if (!normalized || !normalized.stages.length) {
    graph.innerHTML = `<div class="empty">暂无可用阶段定义。</div>`;
    hints.innerHTML = `<div class="mini">请在 DSL 中提供 stages。</div>`;
    return;
  }

  const stageIds = new Set(normalized.stages.map((stage) => stage.id).filter(Boolean));
  const duplicateIds = normalized.stages
    .map((stage) => stage.id)
    .filter((id, index, arr) => id && arr.indexOf(id) !== index);

  graph.innerHTML = normalized.stages
    .map((stage, index) => {
      const nextChips = (stage.next || [])
        .map(
          (target) =>
            `<span class="workflow-link-chip">${escapeHtml(stage.id)} → ${escapeHtml(target)}</span>`,
        )
        .join("");
      const actionChips = Object.entries(stage.actions || {})
        .map(
          ([action, target]) =>
            `<span class="workflow-link-chip action">${escapeHtml(action)} ⇒ ${escapeHtml(target)}</span>`,
        )
        .join("");
      return `<div class="workflow-node">
        <div class="workflow-node-head">
          <strong>${index + 1}. ${escapeHtml(stage.label || stage.id || "未命名阶段")}</strong>
          <span class="workflow-node-id">${escapeHtml(stage.id || "-")}</span>
        </div>
        <div class="mini">${escapeHtml(stage.description || "无描述")}</div>
        <div class="workflow-links">${nextChips || `<span class="workflow-link-chip">无 next</span>`}</div>
        ${actionChips ? `<div class="workflow-links">${actionChips}</div>` : ""}
      </div>`;
    })
    .join("");

  const hintItems = [];
  if (!normalized.id) {
    hintItems.push("缺少 definition.id。");
  }
  if (!normalized.initialStage) {
    hintItems.push("缺少 initialStage。");
  }
  if (normalized.initialStage && !stageIds.has(normalized.initialStage)) {
    hintItems.push(`initialStage=${normalized.initialStage} 未在 stages 中定义。`);
  }
  if (duplicateIds.length) {
    hintItems.push(`存在重复 stage id：${[...new Set(duplicateIds)].join(", ")}`);
  }

  normalized.stages.forEach((stage) => {
    stage.next.forEach((target) => {
      if (!stageIds.has(target)) {
        hintItems.push(`阶段 ${stage.id} 的 next 目标 ${target} 不存在。`);
      }
    });
    Object.entries(stage.actions || {}).forEach(([action, target]) => {
      if (!stageIds.has(target)) {
        hintItems.push(`阶段 ${stage.id} 的 action(${action}) 目标 ${target} 不存在。`);
      }
    });
  });

  hints.innerHTML = hintItems.length
    ? hintItems.map((item) => `<div class="msg error">${escapeHtml(item)}</div>`).join("")
    : `<div class="msg">DSL 结构检查通过。初始阶段：${escapeHtml(normalized.initialStage)}</div>`;
}

function updateWorkflowDefinitionFromUi(mutator) {
  const base = ensureWorkflowDefinition(state.workflowEditorDefinition);
  const next = ensureWorkflowDefinition(JSON.parse(JSON.stringify(base)));
  mutator(next);
  if (!next.initialStage && next.stages.length > 0) {
    next.initialStage = next.stages[0].id || "";
  }
  applyWorkflowDefinitionToEditor(next);
}

function updateTopStatus(data) {
  const validation = data.llm.validation || { errors: [], warnings: [] };
  const calibration = data.llm.calibration || null;
  const calibrationText = getCalibrationStatusText(calibration, validation, data.llm.enabled);
  document.getElementById("llm-provider").textContent = data.llm.providerLabel || "-";
  document.getElementById("llm-status").textContent = `${calibrationText}${data.llm.activeProfileName ? ` / ${data.llm.activeProfileName}` : ""}`;
  document.getElementById("llm-source").textContent = data.llm.source || "-";
  document.getElementById("llm-model-text").textContent = data.llm.model || "-";
  document.getElementById("vault-root").textContent = data.vaultRoot || "-";
  document.getElementById("llm-updated-at").textContent = data.llm.updatedAt || "未更新";
}

function getLlmCards() {
  return Array.isArray(state.dashboard?.llm?.cards) ? state.dashboard.llm.cards : [];
}

function getLlmCardById(profileId) {
  return getLlmCards().find((card) => card.id === profileId) || null;
}

function getCalibrationStatusText(calibration, validation, enabled) {
  if (calibration?.status === "ready") {
    return calibration?.structuredOutput === "connectivity-only" ? "轻量可用" : "可用";
  }
  if (calibration?.status === "running") {
    return "校准中";
  }
  if (calibration?.status === "failed") {
    return "不可用";
  }
  if (validation?.errors?.length) {
    return "配置错误";
  }
  return enabled ? "待校准" : "未就绪";
}

function getCalibrationCapabilityText(calibration) {
  if (!calibration || calibration.status !== "ready") {
    return "";
  }
  if (calibration.structuredOutput === "strict-schema") {
    return "适合正式写作";
  }
  if (calibration.structuredOutput === "connectivity-only") {
    return "适合普通写作";
  }
  return "";
}

function renderLlmCards(data) {
  const llm = data.llm || {};
  const cards = Array.isArray(llm.cards) ? llm.cards : [];
  const container = document.getElementById("llm-card-list");
  if (!cards.length) {
    container.innerHTML = `<div class="empty">还没有模型卡片。先在下方新建一个。</div>`;
    return;
  }

  container.innerHTML = cards
    .map((card) => {
      const validation = card.validation || { errors: [], warnings: [] };
      const calibration = card.calibration || null;
      const statusText = getCalibrationStatusText(calibration, validation, card.enabled);
      const capabilityText = getCalibrationCapabilityText(calibration);
      const summary = calibration?.message || validation.errors[0] || "";
      const providerLabel = card.provider === "openai-codex-oauth" ? "OAuth" : "API Key";
      return `<div class="llm-card ${card.isActive ? "active" : ""}">
        <div class="llm-card-head">
          <div class="llm-card-main">
            <strong>${escapeHtml(card.name || card.id)}</strong>
            <div class="mini llm-card-meta">${escapeHtml(providerLabel)} · ${escapeHtml(card.model || "-")}</div>
            ${
              summary
                ? `<div class="mini llm-card-note ${validation.errors.length ? "danger" : ""}">${escapeHtml(summary)}</div>`
                : ""
            }
          </div>
          <div class="llm-card-badges">
            <span class="chip status-chip ${statusText === "可用" ? "ok" : statusText === "轻量可用" ? "pending" : statusText === "校准中" ? "pending" : statusText === "不可用" || statusText === "配置错误" ? "error" : ""}">${escapeHtml(statusText)}</span>
            ${capabilityText ? `<span class="chip capability-chip">${escapeHtml(capabilityText)}</span>` : ""}
            <span class="chip ${card.isActive ? "active" : ""}">${card.isActive ? "当前启用" : "备用"}</span>
          </div>
        </div>
        <div class="row-actions llm-card-actions">
          <button type="button" class="mini-btn" data-action="llm-edit" data-profile-id="${escapeHtml(card.id)}">编辑</button>
          <button type="button" class="mini-btn" data-action="llm-activate" data-profile-id="${escapeHtml(card.id)}"${card.isActive ? " disabled" : ""}>启用</button>
          <button type="button" class="mini-btn danger" data-action="llm-delete" data-profile-id="${escapeHtml(card.id)}">删除</button>
        </div>
      </div>`;
    })
    .join("");
}

function fillLlmForm(card) {
  const mode = card?.provider || "openai-api-key";
  const model = card?.model || "gpt-5.4";
  const apiType = card?.apiType || "openai-completions";
  const oauthModels = new Set(["gpt-5.4", "gpt-5.3-codex"]);
  const oauthModel = oauthModels.has(model) ? model : "gpt-5.4";
  document.getElementById("llm-card-name-input").value = card?.name || "";
  document.getElementById("llm-mode").value = mode;
  document.getElementById("llm-api-type-select").value = apiType;
  document.getElementById("llm-model-oauth-select").value = oauthModel;
  document.getElementById("llm-model-key-input").value = model;
  document.getElementById("llm-token-input").value = "";
  document.getElementById("llm-base-url-input").value = card?.baseUrl || "https://api.openai.com/v1";
  document.getElementById("llm-auth-url-input").value = card?.authUrl || "";
  document.getElementById("routing-enabled").checked = Boolean(card?.routingEnabled);
  document.getElementById("routing-fast-model").value = card?.fastModel || model || "gpt-5.3-codex";
  document.getElementById("routing-strong-model").value = card?.strongModel || model || "gpt-5.4";
  document.getElementById("routing-fallback-models").value = Array.isArray(card?.fallbackModels)
    ? card.fallbackModels.join(",")
    : "";
  document.getElementById("llm-form-title").textContent = card ? "编辑模型卡片" : "新建模型卡片";
  document.getElementById("llm-editing-meta").textContent = card
    ? `当前编辑：${card.name || card.id}`
    : "未选择卡片";
  document.getElementById("save-llm-settings").textContent = card ? "保存卡片修改" : "保存为模型卡片";
  toggleLlmMode(mode);
  setLlmValidationFeedback(card?.validation || null, card?.calibration?.message || "");
}

function hydrateLlmSettings(data) {
  renderLlmCards(data);
  const activeProfileId = data.llm?.activeProfileId || "";
  const editingProfileId = state.editingLlmProfileId || activeProfileId;
  const card = getLlmCardById(editingProfileId) || getLlmCardById(activeProfileId);
  state.editingLlmProfileId = card?.id || "";
  fillLlmForm(card);
}

async function loadWorkflowDefinitionEditor() {
  const payload = await api("/api/workflow/definition");
  state.workflowDefinition = payload;
  applyWorkflowDefinitionToEditor(payload.definition || {});
  renderWorkflowStageTracker();
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.dashboard = data;
  updateTopStatus(data);
  hydrateLlmSettings(data);
  renderTemplateSelector(data.templateCandidates || data.templates || []);
  renderCheckOptions(
    "wizard-material-options",
    (data.materials || []).filter((item) => !item.isTemplate),
    "sourceMaterialIds",
  );
  renderSettingsLists();
  await loadWorkflowDefinitionEditor();
  updateWizardSummary();
  renderWorkflowStageTracker();
  renderTaskContextSummary();
}

async function importBackgroundMaterialIfNeeded(formData) {
  const upload = formData.get("backgroundUpload");
  if (!(upload instanceof File) || upload.size === 0) {
    return null;
  }

  const payload = {
    mode: "normal",
    title: `${String(formData.get("title") || "未命名任务")} - 本次背景材料`,
    docType: String(formData.get("docType") || "背景材料"),
    audience: String(formData.get("audience") || ""),
    scenario: String(formData.get("scenario") || ""),
    source: "本次写作上传",
    quality: "high",
    tags: "runtime-context",
    uploadName: upload.name,
    uploadBase64: await fileToBase64(upload),
  };

  const result = await api("/api/materials/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.materialId || null;
}

async function createAndRunTask() {
  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);
  const submitButton = document.getElementById("wizard-submit");

  submitButton.disabled = true;
  submitButton.textContent = "生成中...";

  try {
    const sourceMaterialIds = formData.getAll("sourceMaterialIds").map(String).filter(Boolean);
    const templateId = String(formData.get("templateId") || "").trim();
    if (templateId) {
      sourceMaterialIds.unshift(templateId);
    }

    const uploadedBackgroundMaterialId = await importBackgroundMaterialIfNeeded(formData);
    if (uploadedBackgroundMaterialId) {
      sourceMaterialIds.push(uploadedBackgroundMaterialId);
    }

    const taskPayload = {
      title: String(formData.get("title") || "").trim(),
      docType: String(formData.get("docType") || "").trim(),
      audience: String(formData.get("audience") || "").trim(),
      scenario: String(formData.get("scenario") || "").trim(),
      targetLength: String(formData.get("targetLength") || "").trim(),
      deadline: String(formData.get("deadline") || "").trim(),
      goal: String(formData.get("goal") || "").trim(),
      targetEffect: String(formData.get("targetEffect") || "").trim(),
      background: String(formData.get("background") || "").trim(),
      facts: String(formData.get("facts") || "").trim(),
      mustInclude: String(formData.get("mustInclude") || "").trim(),
      specialRequirements: String(formData.get("specialRequirements") || "").trim(),
      templateId,
      templateMode: String(formData.get("templateMode") || "hybrid").trim(),
      templateOverrides: String(formData.get("templateOverrides") || "").trim(),
      sourceMaterialIds: [...new Set(sourceMaterialIds)],
    };

    if (!taskPayload.title || !taskPayload.docType) {
      throw new Error("任务标题和文档类型是必填项。");
    }

    const workflow = await api(
      "/api/workflow/start",
      {
        method: "POST",
        body: JSON.stringify(taskPayload),
      },
      WORKFLOW_START_TIMEOUT_MS,
    );
    const created = workflow.created;
    const generated = workflow.generated;
    const run = workflow.run;

    const draftText =
      generated?.draft?.draft_markdown || (await getTaskDraftFromFile(created.path)) || "生成完成，但未找到正文。";
    document.getElementById("draft-editor").value = draftText;
    state.generatedDraftBaseline = draftText;
    state.pendingAnnotations = [];
    state.latestFeedbackLearnResult = null;
    state.currentGenerationContext = buildGenerationContextFromPayload(generated);
    state.feedbackSelection = null;
    updateSelectionPreview(null);
    renderPendingAnnotations();
    summarizeDraftChanges();
    renderFeedbackLearnResult();
    renderTaskContextSummary();

    state.currentTask = {
      id: created.taskId,
      path: created.path,
      title: taskPayload.title,
      runId: run?.runId || "",
    };
    state.currentWorkflowRun = run || null;

    loadFeedbackHistoryFromStorage(created.taskId);
    renderFeedbackHistory();
    setEditorVisible(true);
    state.wizardStep = 7;
    updateWizardStep();
    setTaskBadge(`当前任务：${taskPayload.title}`);
    renderWorkflowStageTracker();
    setInfo("初稿已生成。你可以直接改正文，写修改原因，再提交反馈继续生成。");
    await loadDashboard();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "生成初稿";
  }
}

async function saveCurrentDraft(finalized) {
  if (!state.currentTask?.path) {
    throw new Error("请先完成一次新建写作并生成初稿。");
  }

  const draft = document.getElementById("draft-editor").value.trim();
  const location = normalizeLocation(document.getElementById("feedback-location").value);
  const reason = String(document.getElementById("feedback-reason").value || "").trim();
  const version = `v${state.feedbackHistory.length + 1}`;

  return api("/api/tasks/update-draft", {
    method: "POST",
    body: JSON.stringify({
      path: state.currentTask.path,
      draft,
      location,
      reason: reason || (finalized ? "直接定稿" : "手动保存"),
      version,
      finalized: finalized ? "true" : "false",
    }),
  });
}

async function submitFeedbackAndRegenerate() {
  if (!state.currentTask?.path || !state.currentTask?.id) {
    throw new Error("请先完成一次新建写作并生成初稿。");
  }

  const draft = document.getElementById("draft-editor").value.trim();
  const unsavedReason = String(document.getElementById("feedback-reason").value || "").trim();
  const unsavedComment = String(document.getElementById("feedback-comment").value || "").trim();
  const hasUnsavedInput =
    normalizeLocation(document.getElementById("feedback-location").value) !== "全文" ||
    Boolean(unsavedReason) ||
    Boolean(unsavedComment);
  const annotations = [...state.pendingAnnotations];
  if (hasUnsavedInput) {
    annotations.push(collectCurrentAnnotation({ strictSelection: false, persist: false }));
  }
  if (!annotations.length) {
    throw new Error("请至少加入一条本轮批注，或填写修改原因/批注说明。");
  }

  const primaryAnnotation = annotations[annotations.length - 1];
  const location = primaryAnnotation.location;
  const reason = primaryAnnotation.reason;
  const comment = primaryAnnotation.comment;
  const selection = primaryAnnotation.selection;

  await saveCurrentDraft(false);

  const feedbackText = [
    `位置：${location}`,
    `修改原因：${reason || "未填写"}`,
    `批注说明：${comment || "未填写"}`,
    `选区范围：${selection ? `${selection.start}-${selection.end}` : "未选择"}`,
    `选区原文：${selection?.text || "未选择"}`,
    "",
    "本轮批注清单：",
    ...annotations.flatMap((item, index) => [
      `${index + 1}. 位置：${item.location}`,
      `   原因：${item.reason || "未填写"}`,
      `   说明：${item.comment || "未填写"}`,
      `   偏好类型：${item.isReusable ? "长期偏好" : "本次修改"}`,
      `   优先级：${item.priority || "medium"}`,
      `   选区：${item.selection ? `${item.selection.start}-${item.selection.end}` : "未选择"}`,
      `   原文：${item.selection?.text || "未选择"}`,
    ]),
    "",
    "用户修改后正文：",
    draft,
  ].join("\n");

  const feedback = await api("/api/feedback/create", {
    method: "POST",
    body: JSON.stringify({
      taskId: state.currentTask.id,
      feedbackType: inferFeedbackType(`${location} ${reason} ${comment}`),
      severity: "medium",
      action: "rewrite",
      rawFeedback: feedbackText,
      affectedParagraph: location,
      affectedSection: selection ? `正文偏移 ${selection.start}-${selection.end}` : location,
      affectsStructure: /结构|顺序|层次/.test(
        annotations.map((item) => `${item.location} ${item.reason} ${item.comment}`).join(" "),
      )
        ? "是"
        : "否",
      selectedText: selection?.text || "",
      selectionStart: selection?.start,
      selectionEnd: selection?.end,
      annotations: annotations.map((item) => ({
        location: item.location,
        reason: item.reason,
        comment: item.comment,
        isReusable: Boolean(item.isReusable),
        priority: item.priority || "medium",
        selectedText: item.selection?.text || "",
        selectionStart: item.selection?.start,
        selectionEnd: item.selection?.end,
      })),
    }),
  });

  const learnResult = await api("/api/feedback/learn", {
    method: "POST",
    body: JSON.stringify({ path: feedback.path }),
  });
  state.latestFeedbackLearnResult = learnResult;

  const generated = state.currentTask.runId
    ? await api("/api/workflow/advance", {
        method: "POST",
        body: JSON.stringify({
          runId: state.currentTask.runId,
          action: "regenerate",
          taskPath: state.currentTask.path,
        }),
      })
    : await api("/api/tasks/run", {
        method: "POST",
        body: JSON.stringify({
          path: state.currentTask.path,
          action: "draft",
        }),
      });

  const latestDraft =
    generated?.generated?.draft?.draft_markdown ||
    generated?.draft?.draft_markdown ||
    (await getTaskDraftFromFile(state.currentTask.path)) ||
    draft;
  const evalResult = await api("/api/feedback/evaluate", {
    method: "POST",
    body: JSON.stringify({
      feedbackPath: feedback.path,
      beforeDraft: draft,
      afterDraft: latestDraft,
      reason: annotations.map((item) => item.reason).filter(Boolean).join("；"),
      comment: annotations.map((item) => item.comment).filter(Boolean).join("；"),
      selectedText: annotations
        .map((item) => item.selection?.text || "")
        .filter(Boolean)
        .join("\n"),
    }),
  });
  const evaluation = evalResult?.evaluation || null;
  if (generated?.run) {
    state.currentWorkflowRun = generated.run;
  }
  document.getElementById("draft-editor").value = latestDraft;
  state.currentGenerationContext = buildGenerationContextFromPayload(generated?.generated || generated);

  const entry = {
    id: feedback.feedbackId,
    taskId: state.currentTask.id,
    location,
    reason,
    comment,
    version: `v${state.feedbackHistory.length + 1}`,
    createdAt: new Date().toISOString(),
    annotationCount: annotations.length,
    reusableAnnotationCount: annotations.filter((item) => item.isReusable).length,
    absorptionScore: evaluation?.score ?? null,
    absorptionLevel: evaluation?.level ?? "",
  };
  state.feedbackHistory.push(entry);
  state.latestFeedbackByLocation[location] = entry;
  saveFeedbackHistoryToStorage(state.currentTask.id);
  renderFeedbackHistory();
  state.pendingAnnotations = [];
  renderPendingAnnotations();
  clearFeedbackInputs();
  state.generatedDraftBaseline = latestDraft;
  renderFeedbackLearnResult();
  renderTaskContextSummary();
  renderWorkflowStageTracker();
  return evaluation;
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => toggleView(tab.dataset.view));
  });
  document.querySelectorAll(".settings-subtab").forEach((tab) => {
    tab.addEventListener("click", () => toggleSettingsPage(tab.dataset.settingsPage));
  });
}

function bindWizard() {
  document.getElementById("wizard-prev").addEventListener("click", () => {
    if (state.wizardStep > 1) {
      state.wizardStep -= 1;
      updateWizardStep();
    }
  });

  document.getElementById("wizard-next").addEventListener("click", () => {
    if (state.wizardStep < MAX_WIZARD_STEP) {
      const blocker = validateStepBeforeNext(state.wizardStep);
      if (blocker) {
        setInfo(blocker, true);
        return;
      }
      state.wizardStep += 1;
      updateWizardStep();
    }
  });

  document.getElementById("wizard-run-check").addEventListener("click", () => {
    const report = runWizardCheck();
    renderWizardCheckResult(report);
    if (report.ok) {
      setInfo("检查通过，可进入确认步骤。");
    } else {
      setInfo("检查未通过，请先修复阻塞项。", true);
    }
    updateWizardSummary();
  });

  document.getElementById("wizard-confirm-check").addEventListener("change", () => {
    if (state.wizardStep >= 6) {
      updateWizardSummary();
    }
  });

  document.getElementById("goto-editor-panel").addEventListener("click", () => {
    const panel = document.getElementById("editor-panel");
    if (!panel || panel.classList.contains("hidden")) {
      setInfo("当前还没有可编辑正文，请先完成生成。", true);
      return;
    }
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("wizard-form").addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if (state.wizardCheckPassed && ["title", "docType", "background", "facts", "mustInclude", "specialRequirements", "sourceMaterialIds", "templateId", "templateMode", "templateOverrides", "backgroundUpload"].includes(target.name || target.id)) {
        state.wizardCheckPassed = false;
        state.wizardCheckReport = null;
        if (state.wizardStep === 5) {
          renderWizardCheckResult(null);
        }
      }
      if (["templateId", "templateMode", "docType", "background", "mustInclude", "specialRequirements"].includes(target.name || target.id)) {
        if ((target.name || target.id) === "templateId" || (target.name || target.id) === "templateMode") {
          renderTemplateChoiceCards(
            Array.isArray(state.dashboard?.templateCandidates)
              ? state.dashboard.templateCandidates
              : Array.isArray(state.dashboard?.templates)
                ? state.dashboard.templates
                : [],
            String(document.getElementById("template-selector")?.value || "").trim(),
          );
          renderTemplatePreview();
        } else {
          renderTemplateSelector(
            Array.isArray(state.dashboard?.templateCandidates)
              ? state.dashboard.templateCandidates
              : Array.isArray(state.dashboard?.templates)
                ? state.dashboard.templates
                : [],
          );
        }
      }
    }
    if (state.wizardStep >= 6) {
      updateWizardSummary();
    }
  });

  document.getElementById("wizard-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.wizardStep !== 6) {
      setInfo("请先进入 Step 6（确认）后再生成。", true);
      return;
    }
    if (!state.wizardCheckPassed) {
      setInfo("请先完成 Step 5 检查并通过。", true);
      return;
    }
    if (!document.getElementById("wizard-confirm-check").checked) {
      setInfo("请先勾选“我已确认输入内容”。", true);
      return;
    }
    try {
      await createAndRunTask();
    } catch (error) {
      setInfo(`生成失败：${error.message}`, true);
      setTaskBadge("生成失败", true);
    }
  });

  document.getElementById("wizard-form").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='pick-template-card']");
    if (!button) {
      return;
    }
    const templateId = button.dataset.templateId || "";
    const select = document.getElementById("template-selector");
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    select.value = templateId;
    renderTemplateChoiceCards(
      Array.isArray(state.dashboard?.templateCandidates)
        ? state.dashboard.templateCandidates
        : Array.isArray(state.dashboard?.templates)
          ? state.dashboard.templates
          : [],
      templateId,
    );
    renderTemplatePreview();
    setInfo(templateId ? "已选中模板卡片。" : "已取消模板。");
  });
}

function bindEditorActions() {
  document.getElementById("capture-selection").addEventListener("click", () => {
    try {
      captureDraftSelection({ strict: true });
      setInfo("已从正文选区自动定位。");
    } catch (error) {
      setInfo(error.message, true);
    }
  });

  document.getElementById("draft-editor").addEventListener("mouseup", () => {
    captureDraftSelection({ strict: false });
  });

  document.getElementById("draft-editor").addEventListener("keyup", () => {
    captureDraftSelection({ strict: false });
  });

  document.getElementById("draft-editor").addEventListener("input", () => {
    captureDraftSelection({ strict: false });
    summarizeDraftChanges();
  });

  document.getElementById("add-annotation").addEventListener("click", () => {
    try {
      collectCurrentAnnotation({ strictSelection: true, persist: true });
      setInfo("已加入本轮批注清单。");
    } catch (error) {
      setInfo(error.message, true);
    }
  });

  document.getElementById("clear-annotations").addEventListener("click", () => {
    state.pendingAnnotations = [];
    state.activeAnnotationIndex = -1;
    renderPendingAnnotations();
    setInfo("已清空本轮批注清单。");
  });

  document.getElementById("annotation-list").addEventListener("click", (event) => {
    const actionButton = event.target.closest("button[data-action]");
    const annotationCard = !actionButton ? event.target.closest("[data-action='select-annotation']") : null;
    if (!actionButton && !annotationCard) {
      return;
    }
    const action = actionButton?.dataset.action || annotationCard?.dataset.action || "";
    const index = Number(actionButton?.dataset.index ?? annotationCard?.dataset.index);
    if (!Number.isInteger(index) || index < 0 || !state.pendingAnnotations[index]) {
      return;
    }
    const annotation = state.pendingAnnotations[index];

    if (action === "select-annotation") {
      state.activeAnnotationIndex = index;
      refillAnnotationForm(annotation);
      try {
        focusAnnotationInDraft(annotation);
      } catch {
        // Ignore missing selection data; refill still helps.
      }
      renderPendingAnnotations();
      setInfo("已切换到这条批注。");
      return;
    }

    if (action === "remove-annotation") {
      state.pendingAnnotations.splice(index, 1);
      if (state.activeAnnotationIndex >= state.pendingAnnotations.length) {
        state.activeAnnotationIndex = state.pendingAnnotations.length - 1;
      }
      renderPendingAnnotations();
      setInfo("已从本轮批注清单移除。");
      return;
    }

    if (action === "edit-annotation") {
      state.activeAnnotationIndex = index;
      refillAnnotationForm(annotation);
      renderPendingAnnotations();
      setInfo("已把这条批注回填到输入区。");
      return;
    }

    if (action === "annotation-up" || action === "annotation-down") {
      const targetIndex = action === "annotation-up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.pendingAnnotations.length) {
        return;
      }
      const [moved] = state.pendingAnnotations.splice(index, 1);
      state.pendingAnnotations.splice(targetIndex, 0, moved);
      state.activeAnnotationIndex = targetIndex;
      renderPendingAnnotations();
      setInfo(action === "annotation-up" ? "已把这条批注前移。" : "已把这条批注后移。");
      return;
    }

    if (action === "focus-annotation") {
      try {
        state.activeAnnotationIndex = index;
        focusAnnotationInDraft(annotation);
        renderPendingAnnotations();
        setInfo("已定位到这条批注对应的正文位置。");
      } catch (error) {
        setInfo(error.message, true);
      }
    }
  });

  document.getElementById("annotation-list").addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action || "";
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || index < 0 || !state.pendingAnnotations[index]) {
      return;
    }

    if (action === "annotation-toggle-reusable" && target instanceof HTMLInputElement) {
      state.pendingAnnotations[index].isReusable = target.checked;
      renderPendingAnnotations();
      return;
    }

    if (action === "annotation-priority" && target instanceof HTMLSelectElement) {
      state.pendingAnnotations[index].priority = target.value;
      summarizeDraftChanges();
    }
  });

  document.getElementById("feedback-learn-result").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action || "";
    const path = button.dataset.path || "";
    if (!path) {
      return;
    }

    try {
      if (action === "confirm-generated-rule" || action === "reject-generated-rule") {
        const result = await api("/api/rules/action", {
          method: "POST",
          body: JSON.stringify({
            path,
            action: action === "confirm-generated-rule" ? "confirm" : "reject",
            reason: action === "confirm-generated-rule" ? "通过编辑区学习结论确认入库" : "通过编辑区学习结论暂不入库",
          }),
        });
        setInfo(
          action === "confirm-generated-rule" ? "已确认候选规则并入库。" : "已将候选规则标记为暂不入库。",
        );
        setSettingsResult(
          action === "confirm-generated-rule" ? "规则确认完成" : "规则暂不入库",
          result,
        );
        if (state.latestFeedbackLearnResult) {
          state.latestFeedbackLearnResult.candidateRulePath = null;
        }
        renderFeedbackLearnResult();
        await loadDashboard();
      }
    } catch (error) {
      setInfo(`规则处理失败：${error.message}`, true);
    }
  });

  document.getElementById("save-draft").addEventListener("click", async () => {
    try {
      await saveCurrentDraft(false);
      setTaskBadge("正文已保存");
      setInfo("已保存当前正文。");
    } catch (error) {
      setTaskBadge("保存失败", true);
      setInfo(error.message, true);
    }
  });

  document.getElementById("submit-feedback").addEventListener("click", async () => {
    const button = document.getElementById("submit-feedback");
    button.disabled = true;
    button.textContent = "生成中...";
    try {
      const evaluation = await submitFeedbackAndRegenerate();
      setTaskBadge("已按反馈再生成");
      const scoreText =
        evaluation && typeof evaluation.score === "number"
          ? `本轮吸收评分 ${evaluation.score}（${evaluation.level}）。`
          : "已完成本轮反馈学习。";
      setInfo(`反馈已学习并生成新稿。${scoreText}你可以继续改，也可以直接定稿。`);
    } catch (error) {
      setTaskBadge("再生成失败", true);
      setInfo(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "提交反馈并再次生成";
    }
  });

  document.getElementById("finalize-draft").addEventListener("click", async () => {
    try {
      await saveCurrentDraft(true);
      if (state.currentTask?.runId) {
        const finalized = await api("/api/workflow/advance", {
          method: "POST",
          body: JSON.stringify({
            runId: state.currentTask.runId,
            action: "finalize",
            taskPath: state.currentTask.path,
          }),
        });
        if (finalized?.run) {
          state.currentWorkflowRun = finalized.run;
        }
      }
      setTaskBadge("已定稿");
      renderWorkflowStageTracker();
      setInfo("已定稿并写入任务文件。");
      await loadDashboard();
    } catch (error) {
      setTaskBadge("定稿失败", true);
      setInfo(error.message, true);
    }
  });
}

function bindMaterialImport() {
  const form = document.getElementById("material-form");
  const modeSelect = form?.querySelector("[name='mode']");
  const hintContainer = document.getElementById("material-mode-hint");
  const materialUploadInput = document.getElementById("material-upload-input");
  const materialUploadSummary = document.getElementById("material-upload-summary");
  const materialUploadTrigger = document.getElementById("material-upload-trigger");

  function openFilePicker(input) {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall through to click() for browsers that expose showPicker but reject it.
      }
    }
    input.click();
  }

  function updateMaterialUploadSummary() {
    if (!(materialUploadInput instanceof HTMLInputElement) || !materialUploadSummary) {
      return;
    }
    const files = Array.from(materialUploadInput.files || []);
    if (!files.length) {
      materialUploadSummary.textContent = "还没有选择导入文件。";
      return;
    }
    if (files.length === 1) {
      materialUploadSummary.textContent = `已选择 1 个文件：${files[0].name}`;
      return;
    }
    materialUploadSummary.textContent = `已选择 ${files.length} 个文件：${files
      .slice(0, 3)
      .map((file) => file.name)
      .join("、")}${files.length > 3 ? " 等" : ""}`;
  }

  function analyzeMaterialImportMode() {
    if (!form || !modeSelect || !hintContainer) {
      return;
    }
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const docType = String(formData.get("docType") || "").trim();
    const source = String(formData.get("source") || "").trim();
    const tags = String(formData.get("tags") || "").trim();
    const combined = `${title} ${docType} ${source} ${tags}`.toLowerCase();

    let suggestedMode = "normal";
    let reason = "这份内容更适合先作为历史材料保存。";
    let usage = "系统后续会主要从中提炼表达习惯、结构参考和常用写法。";

    if (/模板|范式|框架|标准|固定结构|固定格式|套话|通用版|v\d+/i.test(combined)) {
      suggestedMode = "template";
      reason = "标题、标签或命名方式显示它更像一份可反复套用的固定模板。";
      usage = "导入后会进入模板库，并在新建写作时优先影响结构和语气。";
    } else if (/最佳稿|优秀稿|成熟稿|历史最佳|定稿/i.test(combined)) {
      suggestedMode = "normal";
      reason = "这更像一份成熟定稿，适合学习写法，但不一定需要当成硬模板。";
      usage = "导入后会优先用于沉淀你的结构习惯、表达偏好和可复用规则。";
    }

    const currentMode = String(modeSelect.value || "normal");
    hintContainer.innerHTML = `
      <div><strong>建议导入为：${escapeHtml(suggestedMode === "template" ? "正式模板" : "历史材料")}</strong></div>
      <div class="mini">${escapeHtml(reason)}</div>
      <div class="mini">${escapeHtml(usage)}</div>
      ${
        currentMode !== suggestedMode
          ? `<div class="editor-actions"><button type="button" id="apply-material-mode-hint" class="mini-btn">按建议切换</button></div>`
          : `<div class="mini">你当前的选择已经和建议一致。</div>`
      }
    `;

    const applyButton = document.getElementById("apply-material-mode-hint");
    if (applyButton) {
      applyButton.addEventListener("click", () => {
        modeSelect.value = suggestedMode;
        analyzeMaterialImportMode();
        setInfo(`已切换为${suggestedMode === "template" ? "正式模板" : "历史材料"}模式。`);
      });
    }
  }

  form?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    if (["title", "docType", "source", "tags", "mode"].includes(target.name || target.id)) {
      analyzeMaterialImportMode();
    }
  });

  materialUploadInput?.addEventListener("change", () => {
    updateMaterialUploadSummary();
  });
  materialUploadTrigger?.addEventListener("click", () => openFilePicker(materialUploadInput));
  materialUploadTrigger?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    openFilePicker(materialUploadInput);
  });

  analyzeMaterialImportMode();
  updateMaterialUploadSummary();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const mode = String(formData.get("mode") || "normal");
    const uploadFiles = formData.getAll("uploadFile").filter((item) => item instanceof File && item.size > 0);
    const sourceFile = String(formData.get("sourceFile") || "").trim();
    const title = String(formData.get("title") || "").trim();

    const payload = {
      mode,
      isTemplate: mode === "template" ? "true" : "false",
      title,
      docType: String(formData.get("docType") || "").trim(),
      audience: String(formData.get("audience") || "").trim(),
      scenario: String(formData.get("scenario") || "").trim(),
      source: String(formData.get("source") || "").trim(),
      tags: String(formData.get("tags") || "").trim(),
      sourceFile,
      body: String(formData.get("body") || "").trim(),
      quality: mode === "template" ? "high" : "medium",
    };

    if (!payload.docType) {
      setInfo("请先填写文档类型。", true);
      return;
    }

    if (!title && !uploadFiles.length) {
      setInfo("单文件手工导入时，请填写标题；批量上传时可以留空。", true);
      return;
    }

    if (sourceFile && uploadFiles.length > 0) {
      setInfo("批量上传时，请不要同时填写本地文件路径。", true);
      return;
    }

    if (uploadFiles.length > 1) {
      payload.uploadFiles = await Promise.all(
        uploadFiles.map(async (file) => JSON.stringify({ name: file.name, base64: await fileToBase64(file) })),
      );
    } else if (uploadFiles[0] instanceof File) {
      payload.uploadName = uploadFiles[0].name;
      payload.uploadBase64 = await fileToBase64(uploadFiles[0]);
    }

    try {
      const result = await api("/api/materials/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      form.reset();
      updateMaterialUploadSummary();
      await loadDashboard();
      const count = Number(result?.count || 0);
      if (count > 1) {
        setInfo(mode === "template" ? `已批量导入 ${count} 份正式模板。` : `已批量导入 ${count} 份历史材料。`);
      } else {
        setInfo(mode === "template" ? "正式模板已导入。" : "历史材料导入完成。");
      }
      toggleView("settings");
    } catch (error) {
      setInfo(`材料导入失败：${error.message}`, true);
    }
  });
}

function bindBackgroundUploadSummary() {
  const input = document.getElementById("background-upload-input");
  const summary = document.getElementById("background-upload-summary");
  const trigger = document.getElementById("background-upload-trigger");
  if (!(input instanceof HTMLInputElement) || !summary) {
    return;
  }

  const openFilePicker = () => {
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall through to click() for broader compatibility.
      }
    }
    input.click();
  };

  const update = () => {
    const files = Array.from(input.files || []);
    summary.textContent = files.length
      ? `已选择背景文件：${files.map((file) => file.name).join("、")}`
      : "还没有选择背景文件。";
  };

  input.addEventListener("change", update);
  trigger?.addEventListener("click", openFilePicker);
  trigger?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    openFilePicker();
  });
  update();
}

function bindLlmSettings() {
  document.getElementById("llm-mode").addEventListener("change", (event) => {
    toggleLlmMode(event.currentTarget.value);
  });

  document.getElementById("new-llm-card").addEventListener("click", () => {
    state.editingLlmProfileId = "";
    fillLlmForm(null);
    setLlmModalOpen(true);
    setInfo("已切换到新建模型卡片。");
  });

  document.getElementById("close-llm-modal").addEventListener("click", () => {
    setLlmModalOpen(false);
  });

  document.getElementById("llm-editor-modal").addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.closeModal === "true") {
      setLlmModalOpen(false);
    }
  });

  document.getElementById("llm-card-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const profileId = button.dataset.profileId || "";
    if (!profileId) {
      return;
    }

    try {
      if (action === "llm-edit") {
        state.editingLlmProfileId = profileId;
        fillLlmForm(getLlmCardById(profileId));
        setLlmModalOpen(true);
        return;
      }

      if (action === "llm-activate") {
        await api("/api/settings/llm/select", {
          method: "POST",
          body: JSON.stringify({ profileId }),
        });
        state.editingLlmProfileId = profileId;
        await loadDashboard();
        setInfo("模型卡片已切换为当前启用。");
        return;
      }

      if (action === "llm-delete") {
        await api("/api/settings/llm/delete", {
          method: "POST",
          body: JSON.stringify({ profileId }),
        });
        if (state.editingLlmProfileId === profileId) {
          state.editingLlmProfileId = "";
        }
        await loadDashboard();
        setInfo("模型卡片已删除。");
      }
    } catch (error) {
      setInfo(`模型卡片操作失败：${error.message}`, true);
    }
  });

  document.getElementById("save-llm-settings").addEventListener("click", async () => {
    const payload = getLlmFormPayload();
    if (!payload.name) {
      setInfo("请先填写卡片名称。", true);
      return;
    }

    try {
      const result = await api("/api/settings/llm", {
        method: "POST",
        body: JSON.stringify(payload),
      }, 90000);
      state.editingLlmProfileId = result.settings?.id || state.editingLlmProfileId;
      await loadDashboard();
      setLlmModalOpen(false);
      const calibrationMessage = result.calibration?.message || "模型卡片已保存。";
      setInfo(calibrationMessage);
      setSettingsResult("模型卡片已保存", result, { reveal: false });
      toggleSettingsPage("models");
      toggleView("settings");
    } catch (error) {
      setInfo(`保存模型配置失败：${error.message}`, true);
    }
  });

  document.getElementById("start-oauth-login").addEventListener("click", async () => {
    const button = document.getElementById("start-oauth-login");
    button.disabled = true;
    button.textContent = "正在跳转授权...";
    try {
      const payload = getLlmFormPayload();
      if (!payload.name) {
        throw new Error("请先填写卡片名称。");
      }
      const result = await api("/api/settings/llm/oauth/start", {
        method: "POST",
        body: JSON.stringify({
          profileId: payload.profileId,
          name: payload.name,
          provider: "openai-codex-oauth",
          model: payload.model,
        }),
      });
      state.editingLlmProfileId = result.profileId || state.editingLlmProfileId;
      setLlmModalOpen(false);
      const useFallback = state.oauthStartAttempt % 2 === 1 && result.fallbackAuthUrl;
      const authTarget = useFallback ? result.fallbackAuthUrl : result.authUrl;
      state.oauthStartAttempt += 1;
      const popup = window.open(authTarget, "gw-oauth", "width=680,height=820");
      if (!popup) {
        window.location.href = authTarget;
      }
      if (!useFallback) {
        setInfo("已发起 OAuth 登录。如仍报 invalid_request，再点一次会自动切换兼容参数重试。");
      } else {
        setInfo("已使用兼容参数重试 OAuth 登录。");
      }
    } catch (error) {
      setInfo(`OAuth 发起失败：${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = "开始 OAuth 登录";
    }
  });
}

function bindWorkflowDefinitionEditor() {
  document.getElementById("workflow-definition-editor").addEventListener("input", (event) => {
    const raw = String(event.currentTarget.value || "").trim();
    if (!raw) {
      state.workflowEditorDefinition = ensureWorkflowDefinition(null);
      renderWorkflowGraph(null, "DSL 为空。");
      renderWorkflowStageEditor(null, "DSL 为空。");
      return;
    }
    const { definition, error } = safeParseWorkflowEditorValue();
    if (error) {
      renderWorkflowGraph(null, error);
      renderWorkflowStageEditor(null, error);
      return;
    }
    state.workflowEditorDefinition = definition;
    renderWorkflowGraph(definition);
    renderWorkflowStageEditor(definition);
  });

  document.getElementById("reload-workflow-definition").addEventListener("click", async () => {
    const button = document.getElementById("reload-workflow-definition");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "加载中...";
    try {
      await loadWorkflowDefinitionEditor();
      setInfo("已加载最新 Workflow DSL。");
      await loadDashboard();
    } catch (error) {
      setInfo(`加载 Workflow DSL 失败：${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  document.getElementById("wf-add-stage").addEventListener("click", () => {
    updateWorkflowDefinitionFromUi((definition) => {
      const stageId = createUniqueStageId(definition);
      definition.stages.push({
        id: stageId,
        label: `阶段 ${definition.stages.length + 1}`,
        description: "",
        next: [],
        actions: {},
      });
      if (!definition.initialStage) {
        definition.initialStage = stageId;
      }
    });
    setInfo("已新增阶段，可继续补充 next / actions。");
  });

  document.getElementById("wf-meta-id").addEventListener("change", (event) => {
    const value = String(event.currentTarget.value || "").trim();
    updateWorkflowDefinitionFromUi((definition) => {
      definition.id = value;
    });
  });

  document.getElementById("wf-meta-version").addEventListener("change", (event) => {
    const raw = Number(event.currentTarget.value || 1);
    updateWorkflowDefinitionFromUi((definition) => {
      definition.version = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
    });
  });

  document.getElementById("wf-meta-initial").addEventListener("change", (event) => {
    const value = String(event.currentTarget.value || "").trim();
    updateWorkflowDefinitionFromUi((definition) => {
      definition.initialStage = value;
    });
  });

  const stageList = document.getElementById("workflow-stage-list");
  stageList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const field = target.dataset.field || "";
    const index = Number(target.dataset.index);
    if (!field || !Number.isInteger(index) || index < 0) {
      return;
    }

    updateWorkflowDefinitionFromUi((definition) => {
      const stage = definition.stages[index];
      if (!stage) {
        return;
      }
      const raw = String(target.value || "");
      if (field === "id") {
        const oldId = stage.id;
        const newId = raw.trim();
        stage.id = newId;
        if (oldId && newId && oldId !== newId) {
          if (definition.initialStage === oldId) {
            definition.initialStage = newId;
          }
          definition.stages.forEach((item) => {
            item.next = (item.next || []).map((it) => (it === oldId ? newId : it));
            item.actions = Object.fromEntries(
              Object.entries(item.actions || {}).map(([action, targetId]) => [
                action,
                targetId === oldId ? newId : targetId,
              ]),
            );
          });
        }
        return;
      }
      if (field === "label") {
        stage.label = raw.trim();
        return;
      }
      if (field === "description") {
        stage.description = raw.trim();
        return;
      }
      if (field === "next") {
        stage.next = parseTargetsCsv(raw);
        return;
      }
      if (field === "actions") {
        stage.actions = parseActionsFromEditor(raw);
      }
    });
  });

  stageList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action || "";
    const index = Number(button.dataset.index);
    if (!action || !Number.isInteger(index) || index < 0) {
      return;
    }

    updateWorkflowDefinitionFromUi((definition) => {
      const stage = definition.stages[index];
      if (!stage) {
        return;
      }

      if (action === "stage-up" && index > 0) {
        const temp = definition.stages[index - 1];
        definition.stages[index - 1] = stage;
        definition.stages[index] = temp;
        return;
      }
      if (action === "stage-down" && index < definition.stages.length - 1) {
        const temp = definition.stages[index + 1];
        definition.stages[index + 1] = stage;
        definition.stages[index] = temp;
        return;
      }
      if (action === "stage-initial") {
        definition.initialStage = stage.id || "";
        return;
      }
      if (action === "stage-delete") {
        const deletedId = stage.id;
        definition.stages.splice(index, 1);
        definition.stages.forEach((item) => {
          item.next = (item.next || []).filter((targetId) => targetId !== deletedId);
          item.actions = Object.fromEntries(
            Object.entries(item.actions || {}).filter(([, targetId]) => targetId !== deletedId),
          );
        });
        if (definition.initialStage === deletedId) {
          definition.initialStage = definition.stages[0]?.id || "";
        }
      }
    });
  });

  document.getElementById("save-workflow-definition").addEventListener("click", async () => {
    const button = document.getElementById("save-workflow-definition");
    const original = button.textContent;
    const editor = document.getElementById("workflow-definition-editor");
    button.disabled = true;
    button.textContent = "保存中...";
    try {
      const parsed = JSON.parse(editor.value || "{}");
      const result = await api("/api/workflow/definition", {
        method: "POST",
        body: JSON.stringify({ definition: parsed }),
      });
      state.workflowDefinition = result.reloaded || result.saved || null;
      applyWorkflowDefinitionToEditor((result.reloaded && result.reloaded.definition) || parsed);
      setSettingsResult("Workflow DSL 已保存", result);
      setInfo("Workflow DSL 保存成功，后续流程已按新定义生效。");
      await loadDashboard();
    } catch (error) {
      setInfo(`保存 Workflow DSL 失败：${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

async function runSettingsAction(action, button) {
  const path = button.dataset.path || "";
  const title = button.dataset.title || "";

  if (!action) {
    return;
  }

  if (action === "copy-path") {
    await copyText(path, `${title || "路径"}已复制。`);
    return;
  }

  if (action === "view-material" || action === "view-rule" || action === "view-profile" || action === "view-feedback") {
    const data = await api(`/api/document?path=${encodeURIComponent(path)}`);
    const kind =
      action === "view-material"
        ? "material"
        : action === "view-rule"
          ? "rule"
          : action === "view-profile"
            ? "profile"
            : "feedback";
    setSettingsResultPreview(`${title || "文档"} - 内容预览`, buildDocumentPreview(title, data.raw, kind), data.raw);
    return;
  }

  if (action === "view-workflow") {
    const runId = button.dataset.runid || "";
    if (!runId) {
      throw new Error("缺少 workflow runId。");
    }
    const data = await api(`/api/workflow/run?runId=${encodeURIComponent(runId)}`);
    setSettingsResult(`${title || runId} - 编排事件`, data.run);
    return;
  }

  if (action === "view-workflow-definition") {
    const data = await api("/api/workflow/definition");
    setSettingsResult("Workflow DSL", data);
    return;
  }

  if (action === "view-observability") {
    const observabilityId = button.dataset.obid || "";
    const hit = (state.dashboard?.observability || []).find((item) => item.id === observabilityId);
    if (!hit) {
      throw new Error("找不到对应的可观测性记录。");
    }
    setSettingsResult(`可观测性事件：${observabilityId}`, hit);
    return;
  }

  if (action === "analyze-material") {
    const result = await api("/api/materials/analyze", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    setSettingsResult(`${title || "材料"} - 重分析完成`, result);
    setInfo(`已完成材料重分析：${result.roleLabel || "参考材料"}${result.roleReason ? `，${result.roleReason}` : ""}`);
    await loadDashboard();
    return;
  }

  if (action === "material-mark-template" || action === "material-mark-history") {
    const role = action === "material-mark-template" ? "template" : "history";
    const result = await api("/api/materials/role", {
      method: "POST",
      body: JSON.stringify({
        path,
        role,
        reason: action === "material-mark-template" ? "通过设置页转为模板材料" : "通过设置页转为历史材料",
      }),
    });
    setSettingsResult(`${title || "材料"} - 角色已更新`, result);
    const statusText = result.isTemplate
      ? "已进入模板库，后续生成会优先参考它。"
      : result.recommendTemplatePromotion
        ? "已转为历史范文，当前仍会作为候选模板参与推荐。"
        : `已转为${result.roleLabel || "历史材料"}。`;
    applyMaterialRoleUpdate(result);
    setInfo(statusText);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await loadDashboard();
    return;
  }

  if (action === "rule-confirm" || action === "rule-disable" || action === "rule-reject") {
    const mappedAction =
      action === "rule-confirm" ? "confirm" : action === "rule-disable" ? "disable" : "reject";
    const result = await api("/api/rules/action", {
      method: "POST",
      body: JSON.stringify({ path, action: mappedAction, reason: "通过设置页操作" }),
    });
    setSettingsResult(`规则操作完成：${mappedAction}`, result);
    const updatedCount = Array.isArray(result.updatedTasks) ? result.updatedTasks.length : 0;
    const updatedTaskTitles = Array.isArray(result.updatedTasks)
      ? result.updatedTasks
          .map((task) => (task && typeof task.title === "string" ? task.title : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    setInfo(
      `规则已${mappedAction === "confirm" ? "确认" : mappedAction === "disable" ? "停用" : "拒绝"}，已同步 ${updatedCount} 个任务${updatedTaskTitles.length ? `（${updatedTaskTitles.join(" / ")}）` : ""}${result.profilePath ? "，并刷新写作画像" : ""}。`,
    );
    await loadDashboard();
    return;
  }

  if (action === "feedback-confirm-rule") {
    const result = await api("/api/rules/action", {
      method: "POST",
      body: JSON.stringify({ path, action: "confirm", reason: "通过反馈记录快捷确认候选规则" }),
    });
    setSettingsResult(`规则操作完成：confirm`, result);
    const updatedCount = Array.isArray(result.updatedTasks) ? result.updatedTasks.length : 0;
    const updatedTaskTitles = Array.isArray(result.updatedTasks)
      ? result.updatedTasks
          .map((task) => (task && typeof task.title === "string" ? task.title : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    setInfo(`已从反馈记录确认规则，已同步 ${updatedCount} 个任务${updatedTaskTitles.length ? `（${updatedTaskTitles.join(" / ")}）` : ""}${result.profilePath ? "，并刷新写作画像" : ""}。`);
    await loadDashboard();
    return;
  }

  if (action === "rule-view-versions") {
    const result = await api(`/api/rules/versions?path=${encodeURIComponent(path)}`);
    setSettingsResult(`${title || "规则"} - 版本历史`, result);
    return;
  }

  if (action === "rule-set-scope") {
    const scope = window.prompt("请输入规则适用范围（scope）：", "") || "";
    const docTypesRaw = window.prompt("请输入适用文体（逗号分隔，可留空）：", "") || "";
    const audiencesRaw = window.prompt("请输入适用受众（逗号分隔，可留空）：", "") || "";
    const reason = window.prompt("请输入本次范围调整原因：", "通过设置页调整适用范围") || "";
    const docTypes = docTypesRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const audiences = audiencesRaw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const result = await api("/api/rules/scope", {
      method: "POST",
      body: JSON.stringify({ path, scope, docTypes, audiences, reason }),
    });
    setSettingsResult(`${title || "规则"} - 范围更新完成`, result);
    await loadDashboard();
    return;
  }

  if (action === "rule-rollback") {
    const versions = await api(`/api/rules/versions?path=${encodeURIComponent(path)}`);
    if (!versions.versions?.length) {
      throw new Error("暂无可回滚版本。");
    }

    const top = versions.versions.slice(0, 12);
    const hint = top
      .map((item, index) => `${index + 1}. ${item.versionId} / ${item.action} / ${item.createdAt}`)
      .join("\n");
    const picked = window.prompt(`请输入要回滚的版本编号或 versionId：\n${hint}`, "1") || "";
    let versionId = picked.trim();
    if (/^\d+$/.test(versionId)) {
      const index = Number(versionId) - 1;
      versionId = top[index]?.versionId || "";
    }
    if (!versionId) {
      throw new Error("未选择有效版本。");
    }
    const reason =
      window.prompt("请输入回滚原因：", `通过设置页回滚到 ${versionId}`) ||
      `通过设置页回滚到 ${versionId}`;

    const result = await api("/api/rules/rollback", {
      method: "POST",
      body: JSON.stringify({ path, versionId, reason }),
    });
    setSettingsResult(`${title || "规则"} - 回滚完成`, result);
    await loadDashboard();
    return;
  }

  if (action === "learn-feedback") {
    const result = await api("/api/feedback/learn", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    setSettingsResult(`${title || "反馈"} - 学习结果`, result);
    await loadDashboard();
  }
}

function bindSettingsActions() {
  const containers = [
    "obsidian-quick-actions",
    "settings-materials",
    "settings-templates",
    "settings-rules",
    "settings-profiles",
    "settings-feedback",
    "settings-workflows",
    "settings-observability",
  ];

  for (const id of containers) {
    const container = document.getElementById(id);
    container.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "处理中...";
      try {
        await runSettingsAction(action, button);
      } catch (error) {
        setSettingsResult("操作失败", { error: error.message });
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  document.getElementById("refresh-profile").addEventListener("click", async () => {
    const button = document.getElementById("refresh-profile");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "刷新中...";
    try {
      const result = await api("/api/refresh/profile", { method: "POST" });
      setSettingsResult("写作画像刷新完成", result);
      await loadDashboard();
    } catch (error) {
      setSettingsResult("刷新画像失败", { error: error.message });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

window.addEventListener("message", async (event) => {
  if (!trustedOrigins.has(event.origin)) {
    return;
  }
  if (event.data?.type === "oauth-complete" && event.data?.ok) {
    state.oauthStartAttempt = 0;
    await loadDashboard();
    setInfo("OAuth 登录成功，模型状态已刷新。");
  }
});

bindTabs();
bindWizard();
bindEditorActions();
bindMaterialImport();
bindBackgroundUploadSummary();
bindLlmSettings();
bindWorkflowDefinitionEditor();
bindSettingsActions();
startButtonTooltipObserver();
updateWizardStep();
setEditorVisible(false);

loadDashboard().catch((error) => {
  setInfo(`初始化失败：${error.message}`, true);
});
