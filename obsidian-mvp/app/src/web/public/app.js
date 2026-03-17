const state = {
  dashboard: null,
  currentView: "create",
  wizardStep: 1,
  wizardCheckPassed: false,
  wizardCheckReport: null,
  currentTask: null,
  currentWorkflowRun: null,
  feedbackHistory: [],
  latestFeedbackByLocation: {},
  workflowDefinition: null,
  workflowEditorDefinition: null,
};

const MAX_WIZARD_STEP = 7;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setInfo(message, isError = false) {
  const summary = document.getElementById("wizard-summary");
  if (!summary) {
    return;
  }
  summary.innerHTML = `<div class="${isError ? "msg error" : "msg"}">${escapeHtml(message)}</div>`;
}

function setSettingsResult(title, payload) {
  const container = document.getElementById("settings-result");
  if (!container) {
    return;
  }

  const content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  container.innerHTML = `<h3>${escapeHtml(title)}</h3><pre>${escapeHtml(content)}</pre>`;
}

function setTaskBadge(text, isError = false) {
  const badge = document.getElementById("task-badge");
  if (!badge) {
    return;
  }
  badge.textContent = text;
  badge.classList.toggle("danger", isError);
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
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

function updateWizardSummary() {
  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);
  const selectedCount = formData.getAll("sourceMaterialIds").length;
  const templateTitle =
    document.querySelector("#template-selector option:checked")?.textContent || "不使用模板";
  const lines = [
    `任务：${String(formData.get("title") || "").trim() || "未填写"}`,
    `文档类型：${String(formData.get("docType") || "").trim() || "未填写"}`,
    `模板：${templateTitle}`,
    `历史材料：${selectedCount} 篇`,
    `背景条目：${String(formData.get("background") || "").trim() ? "已填写" : "未填写"}`,
    `检查状态：${state.wizardCheckPassed ? "已通过" : "未通过"}`,
  ];
  document.getElementById("wizard-summary").innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
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
  if (!container) {
    return;
  }

  if (!report) {
    container.innerHTML = `<div>点击“执行检查”开始。</div>`;
    return;
  }

  const blockerLines = report.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const warningLines = report.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  container.innerHTML = `
    <div class="${report.ok ? "msg" : "msg error"}">${report.ok ? "检查通过，可进入确认步骤。" : "检查未通过，请先修复阻塞项。"}</div>
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
  const editorStage = document.getElementById("workflow-editor-stage");
  if (!tracker || !note || !editorStage) {
    return;
  }

  const stages = getWorkflowStagesForUi();
  if (!stages.length) {
    tracker.innerHTML = `<div class="empty">暂无流程定义。</div>`;
    note.textContent = "当前阶段：未定义";
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
      return `<div class="workflow-stage-item ${status}">
        <div class="stage-no">第 ${index + 1} 步</div>
        <strong>${escapeHtml(stage.label || stage.id)}</strong>
        <div class="mini">${escapeHtml(stage.description || "")}</div>
      </div>`;
    })
    .join("");

  const activeStage = stages[activeIndex] || stages[0];
  const statusText = run ? `（Run: ${run.status || "running"}）` : "（表单引导）";
  note.textContent = `当前阶段：${activeStage.label || activeStage.id}${statusText}`;
  editorStage.textContent = run
    ? `当前编排阶段：${activeStage.label || activeStage.id} / ${run.currentStage || "-"}`
    : "当前编排阶段：未开始（先完成前4步并生成）";
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

  for (const item of items) {
    const label = document.createElement("label");
    label.className = "check-item";
    label.innerHTML = `
      <input type="checkbox" name="${name}" value="${escapeHtml(item.id)}" />
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <span class="mini">类型：${escapeHtml(item.docType || "-")} / 场景：${escapeHtml(item.scenario || "-")}</span>
      </span>
    `;
    container.append(label);
  }
}

function renderTemplateSelector(items) {
  const select = document.getElementById("template-selector");
  select.innerHTML = `<option value="">不使用模板</option>`;
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title}${item.docType ? `（${item.docType}）` : ""}`;
    select.append(option);
  }
}

function renderSimpleList(containerId, items, renderItem) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "row-item";
    row.innerHTML = renderItem(item);
    container.append(row);
  }
}

function renderSettingsLists() {
  const data = state.dashboard || {};
  renderSimpleList("settings-materials", data.materials || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">${escapeHtml(item.docType || "-")} / ${escapeHtml(item.audience || "-")} / ${escapeHtml(item.quality || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看</button>
      <button type="button" class="mini-btn" data-action="analyze-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">重分析</button>
    </div>`;
  });

  renderSimpleList("settings-templates", data.templates || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">模板权重高 / ${escapeHtml(item.docType || "-")} / ${escapeHtml(item.scenario || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-material" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看模板</button>
    </div>`;
  });

  renderSimpleList("settings-rules", data.rules || [], (item) => {
    const docTypes = Array.isArray(item.docTypes) ? item.docTypes.join(", ") : "";
    const audiences = Array.isArray(item.audiences) ? item.audiences.join(", ") : "";
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">${escapeHtml(item.status)} / scope=${escapeHtml(item.scope || "-")} / 文体=${escapeHtml(docTypes || "-")} / 受众=${escapeHtml(audiences || "-")} / 版本=${escapeHtml(String(item.versionCount ?? 0))} / 置信度 ${escapeHtml(String(item.confidence ?? 0))}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-rule" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看</button>
      <button type="button" class="mini-btn" data-action="rule-set-scope" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">设范围</button>
      <button type="button" class="mini-btn" data-action="rule-view-versions" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">版本</button>
      <button type="button" class="mini-btn" data-action="rule-rollback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">回滚</button>
      <button type="button" class="mini-btn" data-action="rule-confirm" data-path="${escapeHtml(item.path)}">确认</button>
      <button type="button" class="mini-btn" data-action="rule-disable" data-path="${escapeHtml(item.path)}">停用</button>
      <button type="button" class="mini-btn" data-action="rule-reject" data-path="${escapeHtml(item.path)}">拒绝</button>
    </div>`;
  });

  renderSimpleList("settings-profiles", data.profiles || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.name)}</strong>
      <div class="mini">版本 ${escapeHtml(String(item.version || 1))}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-profile" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.name)}">查看</button>
    </div>`;
  });

  renderSimpleList("settings-feedback", data.feedback || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.id)}</strong>
      <div class="mini">${escapeHtml(item.feedbackType || "-")} / 任务 ${escapeHtml(item.taskId || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-feedback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.id)}">查看</button>
      <button type="button" class="mini-btn" data-action="learn-feedback" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.id)}">学习反馈</button>
    </div>`;
  });

  renderSimpleList("settings-workflows", data.workflowRuns || [], (item) => {
    return `<div class="row-main">
      <strong>${escapeHtml(item.title || item.taskId || item.runId)}</strong>
      <div class="mini">Run ${escapeHtml(item.runId)} / ${escapeHtml(item.status)} / ${escapeHtml(item.currentStage)} / ${escapeHtml(item.updatedAt || "-")}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-workflow" data-runid="${escapeHtml(item.runId)}" data-title="${escapeHtml(item.title || item.runId)}">查看事件</button>
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

function toggleLlmMode(mode) {
  const isOauth = mode === "openai-codex-oauth";
  document.getElementById("oauth-config").classList.toggle("hidden", !isOauth);
  document.getElementById("key-config").classList.toggle("hidden", isOauth);
  document.getElementById("llm-model-oauth-wrap").classList.toggle("hidden", !isOauth);
  document.getElementById("llm-model-key-wrap").classList.toggle("hidden", isOauth);
  if (isOauth && !document.getElementById("llm-model-oauth-select").value) {
    document.getElementById("llm-model-oauth-select").value = "gpt-5.4";
  }
}

function renderFeedbackHistory() {
  const container = document.getElementById("feedback-history");
  if (!state.feedbackHistory.length) {
    container.innerHTML = `<div class="empty">还没有反馈记录，先改一轮正文再提交。</div>`;
    return;
  }

  const latestRows = Object.values(state.latestFeedbackByLocation)
    .map((item) => `<li><strong>${escapeHtml(item.location)}</strong>：${escapeHtml(item.reason || "未填原因")}（最新版本 ${escapeHtml(item.version || "-")}）</li>`)
    .join("");

  const allRows = [...state.feedbackHistory]
    .reverse()
    .map(
      (item) => `<li>
        <div><strong>${escapeHtml(item.version || "-")}</strong> ${escapeHtml(item.createdAt || "")}</div>
        <div>位置：${escapeHtml(item.location)}</div>
        <div>原因：${escapeHtml(item.reason || "-")}</div>
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
  document.getElementById("llm-provider").textContent = data.llm.providerLabel || "-";
  document.getElementById("llm-status").textContent = data.llm.enabled ? "已可调用" : "未就绪";
  document.getElementById("llm-source").textContent = data.llm.source || "-";
  document.getElementById("llm-model-text").textContent = data.llm.model || "-";
  document.getElementById("vault-root").textContent = data.vaultRoot || "-";
  document.getElementById("llm-updated-at").textContent = data.llm.updatedAt || "未更新";
}

function hydrateLlmSettings(data) {
  const llm = data.llm || {};
  const mode = llm.provider || "openai-api-key";
  const oauthModels = new Set(["gpt-5.4", "gpt-5.3-codex"]);
  const oauthModel = oauthModels.has(llm.model) ? llm.model : "gpt-5.4";
  document.getElementById("llm-mode").value = mode;
  document.getElementById("llm-model-oauth-select").value = oauthModel;
  document.getElementById("llm-model-key-input").value = llm.model || "gpt-5.4";
  document.getElementById("llm-base-url-input").value = llm.baseUrl || "https://api.openai.com/v1";
  toggleLlmMode(mode);
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
  renderTemplateSelector(data.templates || []);
  renderCheckOptions("wizard-material-options", data.materials || [], "sourceMaterialIds");
  renderSettingsLists();
  await loadWorkflowDefinitionEditor();
  updateWizardSummary();
  renderWorkflowStageTracker();
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
      sourceMaterialIds: [...new Set(sourceMaterialIds)],
    };

    if (!taskPayload.title || !taskPayload.docType) {
      throw new Error("任务标题和文档类型是必填项。");
    }

    const workflow = await api("/api/workflow/start", {
      method: "POST",
      body: JSON.stringify(taskPayload),
    });
    const created = workflow.created;
    const generated = workflow.generated;
    const run = workflow.run;

    const draftText =
      generated?.draft?.draft_markdown || (await getTaskDraftFromFile(created.path)) || "生成完成，但未找到正文。";
    document.getElementById("draft-editor").value = draftText;

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
  const location = normalizeLocation(document.getElementById("feedback-location").value);
  const reason = String(document.getElementById("feedback-reason").value || "").trim();
  const comment = String(document.getElementById("feedback-comment").value || "").trim();

  if (!reason && !comment) {
    throw new Error("请至少填写“修改原因”或“批注说明”。");
  }

  await saveCurrentDraft(false);

  const feedbackText = [
    `位置：${location}`,
    `修改原因：${reason || "未填写"}`,
    `批注说明：${comment || "未填写"}`,
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
      affectedSection: location,
      affectsStructure: /结构|顺序|层次/.test(`${location} ${reason} ${comment}`) ? "是" : "否",
    }),
  });

  await api("/api/feedback/learn", {
    method: "POST",
    body: JSON.stringify({ path: feedback.path }),
  });

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
  if (generated?.run) {
    state.currentWorkflowRun = generated.run;
  }
  document.getElementById("draft-editor").value = latestDraft;

  const entry = {
    id: feedback.feedbackId,
    taskId: state.currentTask.id,
    location,
    reason,
    comment,
    version: `v${state.feedbackHistory.length + 1}`,
    createdAt: new Date().toISOString(),
  };
  state.feedbackHistory.push(entry);
  state.latestFeedbackByLocation[location] = entry;
  saveFeedbackHistoryToStorage(state.currentTask.id);
  renderFeedbackHistory();
  renderWorkflowStageTracker();
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => toggleView(tab.dataset.view));
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
      if (state.wizardCheckPassed && ["title", "docType", "background", "facts", "mustInclude", "specialRequirements", "sourceMaterialIds", "templateId", "backgroundUpload"].includes(target.name || target.id)) {
        state.wizardCheckPassed = false;
        state.wizardCheckReport = null;
        if (state.wizardStep === 5) {
          renderWizardCheckResult(null);
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
}

function bindEditorActions() {
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
      await submitFeedbackAndRegenerate();
      setTaskBadge("已按反馈再生成");
      setInfo("反馈已学习并生成新稿。你可以继续改，也可以直接定稿。");
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
  document.getElementById("material-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const mode = String(formData.get("mode") || "normal");
    const uploadFile = formData.get("uploadFile");

    const payload = {
      mode,
      isTemplate: mode === "template" ? "true" : "false",
      title: String(formData.get("title") || "").trim(),
      docType: String(formData.get("docType") || "").trim(),
      audience: String(formData.get("audience") || "").trim(),
      scenario: String(formData.get("scenario") || "").trim(),
      source: String(formData.get("source") || "").trim(),
      tags: String(formData.get("tags") || "").trim(),
      sourceFile: String(formData.get("sourceFile") || "").trim(),
      body: String(formData.get("body") || "").trim(),
      quality: mode === "template" ? "high" : "medium",
    };

    if (uploadFile instanceof File && uploadFile.size > 0) {
      payload.uploadName = uploadFile.name;
      payload.uploadBase64 = await fileToBase64(uploadFile);
    }

    try {
      await api("/api/materials/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      form.reset();
      await loadDashboard();
      setInfo(mode === "template" ? "模板材料已导入（高权重）。" : "历史材料导入完成。");
      toggleView("settings");
    } catch (error) {
      setInfo(`材料导入失败：${error.message}`, true);
    }
  });
}

function bindLlmSettings() {
  document.getElementById("llm-mode").addEventListener("change", (event) => {
    toggleLlmMode(event.currentTarget.value);
  });

  document.getElementById("save-llm-settings").addEventListener("click", async () => {
    const mode = document.getElementById("llm-mode").value;
    const model =
      mode === "openai-codex-oauth"
        ? document.getElementById("llm-model-oauth-select").value
        : document.getElementById("llm-model-key-input").value.trim();
    const payload = {
      provider: mode,
      model,
      bearerToken: document.getElementById("llm-token-input").value.trim(),
      baseUrl: document.getElementById("llm-base-url-input").value.trim(),
      authUrl: document.getElementById("llm-auth-url-input").value.trim(),
    };

    try {
      await api("/api/settings/llm", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadDashboard();
      setInfo(mode === "openai-codex-oauth" ? "OAuth 模式配置已保存。" : "API Key 模式配置已保存。");
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
      const model = document.getElementById("llm-model-oauth-select").value;
      const result = await api("/api/settings/llm/oauth/start", {
        method: "POST",
        body: JSON.stringify({ provider: "openai-codex-oauth", model }),
      });
      const popup = window.open(result.authUrl, "gw-oauth", "width=680,height=820");
      if (!popup) {
        window.location.href = result.authUrl;
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

  if (action === "view-material" || action === "view-rule" || action === "view-profile" || action === "view-feedback") {
    const data = await api(`/api/document?path=${encodeURIComponent(path)}`);
    setSettingsResult(`${title || "文档"} - 内容预览`, data.raw);
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

  if (action === "analyze-material") {
    const result = await api("/api/materials/analyze", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    setSettingsResult(`${title || "材料"} - 重分析完成`, result);
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
    "settings-materials",
    "settings-templates",
    "settings-rules",
    "settings-profiles",
    "settings-feedback",
    "settings-workflows",
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
    await loadDashboard();
    setInfo("OAuth 登录成功，模型状态已刷新。");
  }
});

bindTabs();
bindWizard();
bindEditorActions();
bindMaterialImport();
bindLlmSettings();
bindWorkflowDefinitionEditor();
bindSettingsActions();
updateWizardStep();
setEditorVisible(false);

loadDashboard().catch((error) => {
  setInfo(`初始化失败：${error.message}`, true);
});
