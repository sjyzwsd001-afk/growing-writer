const state = {
  dashboard: null,
  currentView: "create",
  wizardStep: 1,
  currentTask: null,
  feedbackHistory: [],
  latestFeedbackByLocation: {},
};

const MAX_WIZARD_STEP = 4;
const trustedOrigins = new Set([
  window.location.origin,
  window.location.origin.replace("127.0.0.1", "localhost"),
  window.location.origin.replace("localhost", "127.0.0.1"),
]);

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
  ];
  document.getElementById("wizard-summary").innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

function updateWizardStep() {
  document.getElementById("wizard-step-index").textContent = String(state.wizardStep);
  document.querySelectorAll(".wizard-step").forEach((step) => {
    step.classList.toggle("active", Number(step.dataset.step) === state.wizardStep);
  });
  document.getElementById("wizard-prev").disabled = state.wizardStep === 1;
  document.getElementById("wizard-next").classList.toggle("hidden", state.wizardStep >= MAX_WIZARD_STEP);
  document.getElementById("wizard-submit").classList.toggle("hidden", state.wizardStep < MAX_WIZARD_STEP);
  if (state.wizardStep === MAX_WIZARD_STEP) {
    updateWizardSummary();
  }
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
    return `<div class="row-main">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="mini">${escapeHtml(item.status)} / ${escapeHtml(item.scope || "-")} / 置信度 ${escapeHtml(String(item.confidence ?? 0))}</div>
    </div>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-action="view-rule" data-path="${escapeHtml(item.path)}" data-title="${escapeHtml(item.title)}">查看</button>
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

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.dashboard = data;
  updateTopStatus(data);
  hydrateLlmSettings(data);
  renderTemplateSelector(data.templates || []);
  renderCheckOptions("wizard-material-options", data.materials || [], "sourceMaterialIds");
  renderSettingsLists();
  updateWizardSummary();
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

    loadFeedbackHistoryFromStorage(created.taskId);
    renderFeedbackHistory();
    setEditorVisible(true);
    setTaskBadge(`当前任务：${taskPayload.title}`);
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
      state.wizardStep += 1;
      updateWizardStep();
    }
  });

  document.getElementById("wizard-form").addEventListener("input", () => {
    if (state.wizardStep === MAX_WIZARD_STEP) {
      updateWizardSummary();
    }
  });

  document.getElementById("wizard-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.wizardStep !== MAX_WIZARD_STEP) {
      setInfo("请先走完整个引导步骤再生成。", true);
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
        await api("/api/workflow/advance", {
          method: "POST",
          body: JSON.stringify({
            runId: state.currentTask.runId,
            action: "finalize",
            taskPath: state.currentTask.path,
          }),
        });
      }
      setTaskBadge("已定稿");
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
bindSettingsActions();
updateWizardStep();
setEditorVisible(false);

loadDashboard().catch((error) => {
  setInfo(`初始化失败：${error.message}`, true);
});
