const state = {
  dashboard: null,
  filters: {
    materials: "",
    tasks: "",
    rules: "",
    ruleStatus: "all",
    profiles: "",
    feedback: "",
  },
};

const resultViewer = document.getElementById("result-viewer");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function setResult(title, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  resultViewer.innerHTML = `<pre>${escapeHtml(`${title}\n\n${body}`)}</pre>`;
}

function setRichResult(title, sections) {
  resultViewer.innerHTML = `
    <div class="result-stack">
      <div class="result-card">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${sections.join("")}
    </div>
  `;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesSearch(values, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => normalizeText(value).includes(normalizedQuery));
}

function parseMarkdownSections(raw) {
  const text = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
  const matches = [...text.matchAll(/^##\s+(.+)\n([\s\S]*?)(?=^##\s+|\Z)/gm)];
  return matches.map((match) => ({
    heading: match[1].trim(),
    body: match[2].trim(),
  }));
}

function parseTopLevelSections(raw) {
  const text = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
  const matches = [...text.matchAll(/^#\s+(.+)\n([\s\S]*?)(?=^#\s+|\Z)/gm)];
  return matches.map((match) => ({
    heading: match[1].trim(),
    body: match[2].trim(),
  }));
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

function makeButton(label, onClick, className = "inline-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderMaterials(items) {
  const container = document.getElementById("materials-list");
  document.getElementById("materials-count").textContent = String(items.length);
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="card"><div class="meta">还没有材料，先在上方导入一篇。</div></div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.title}</h3>
      <div class="meta">
        <div>类型：${item.docType || "-"}</div>
        <div>对象：${item.audience || "-"}</div>
        <div>场景：${item.scenario || "-"}</div>
        <div>质量：${item.quality || "-"}</div>
      </div>
      <div class="actions"></div>
    `;

    const actions = card.querySelector(".actions");
    actions.append(
      makeButton("结构预览", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        const sections = parseTopLevelSections(data.raw);
        const lookup = Object.fromEntries(sections.map((section) => [section.heading, section.body]));
        setRichResult(`材料预览：${item.title}`, [
          `
            <section class="result-card">
              <h4>材料摘要</h4>
              <div class="result-grid">
                <div><strong>类型</strong><div>${escapeHtml(item.docType || "-")}</div></div>
                <div><strong>对象</strong><div>${escapeHtml(item.audience || "-")}</div></div>
                <div><strong>场景</strong><div>${escapeHtml(item.scenario || "-")}</div></div>
                <div><strong>质量</strong><div>${escapeHtml(item.quality || "-")}</div></div>
              </div>
            </section>
          `,
          `
            <section class="result-card">
              <h4>原文内容</h4>
              <pre>${escapeHtml(lookup["原文内容"] || "无")}</pre>
            </section>
          `,
          `
            <section class="result-card">
              <h4>结构拆解</h4>
              <pre>${escapeHtml(lookup["结构拆解"] || "无")}</pre>
            </section>
          `,
          `
            <section class="result-card">
              <h4>风格观察</h4>
              <pre>${escapeHtml(lookup["风格观察"] || "无")}</pre>
            </section>
          `,
        ]);
      }),
      makeButton("查看原文", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        setResult(`材料文件：${item.title}`, data.raw);
      }),
      makeButton("重分析", async () => {
        const data = await api("/api/materials/analyze", {
          method: "POST",
          body: JSON.stringify({ path: item.path }),
        });
        setResult(`材料重分析完成：${item.title}`, data);
        await loadDashboard();
      }),
    );

    container.append(card);
  }
}

function renderTaskMaterialOptions(items) {
  const container = document.getElementById("task-material-options");
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="meta">还没有可选材料，先在上面导入几篇。</div>`;
    return;
  }

  for (const item of items) {
    const label = document.createElement("label");
    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" name="sourceMaterialIds" value="${item.id}" />
      <span>
        <strong>${item.title}</strong><br />
        <span class="meta">类型：${item.docType || "-"} / 对象：${item.audience || "-"}</span>
      </span>
    `;
    container.append(label);
  }
}

function renderFeedbackTaskOptions(items) {
  const select = document.getElementById("feedback-task-options");
  select.innerHTML = `<option value="">不关联任务</option>`;

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title} (${item.docType || "未标注文档类型"})`;
    select.append(option);
  }
}

function renderTasks(items) {
  const container = document.getElementById("tasks-list");
  document.getElementById("tasks-count").textContent = String(items.length);
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="card"><div class="meta">任务目录里还没有任务文件。</div></div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.title}</h3>
      <div class="meta">
        <div>状态：${item.status || "-"}</div>
        <div>类型：${item.docType || "-"}</div>
        <div>对象：${item.audience || "-"}</div>
        <div>已匹配规则：${(item.matchedRules || []).length}</div>
      </div>
      <div class="actions"></div>
    `;

    const actions = card.querySelector(".actions");
    actions.append(
      makeButton("查看文件", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        setRichResult(`任务文件：${item.title}`, [
          `<section class="result-card"><pre>${escapeHtml(data.raw)}</pre></section>`,
        ]);
      }),
      makeButton("看最新结果", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        const sections = parseTopLevelSections(data.raw);
        const wanted = ["写前诊断", "参考依据", "提纲", "初稿", "修改记录"];
        const picked = sections.filter((section) => wanted.includes(section.heading));
        setRichResult(`任务最新结果：${item.title}`, picked.length
          ? picked.map(
              (section) => `
                <section class="result-card">
                  <h4>${escapeHtml(section.heading)}</h4>
                  <pre>${escapeHtml(section.body)}</pre>
                </section>
              `,
            )
          : [
              `<section class="result-card"><pre>${escapeHtml("这条任务还没有生成结果。")}</pre></section>`,
            ]);
      }),
      makeButton("一键生成", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "draft" }),
        });
        showTaskResult(`任务一键生成：${item.title}`, data);
        await loadDashboard();
      }, "inline-button primary-button"),
      makeButton("跑诊断", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "diagnose" }),
        });
        showTaskResult(`任务诊断：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("跑提纲", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "outline" }),
        });
        showTaskResult(`任务提纲：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("跑初稿", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "draft" }),
        });
        showTaskResult(`任务初稿：${item.title}`, data);
        await loadDashboard();
      }),
    );

    container.append(card);
  }
}

function renderRules(items) {
  const container = document.getElementById("rules-list");
  document.getElementById("rules-count").textContent = String(items.length);
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="card"><div class="meta">当前没有规则文件。</div></div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.title}</h3>
      <div class="meta">
        <div>状态：<span class="status-${item.status}">${item.status}</span></div>
        <div>范围：${item.scope || "-"}</div>
        <div>置信度：${item.confidence}</div>
      </div>
      <div class="actions"></div>
    `;

    const actions = card.querySelector(".actions");
    actions.append(
      makeButton("查看文件", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        const sections = parseMarkdownSections(data.raw);
        setRichResult(`规则预览：${item.title}`, [
          `
            <section class="result-card">
              <h4>规则摘要</h4>
              <div class="result-grid">
                <div><strong>状态</strong><div>${escapeHtml(item.status)}</div></div>
                <div><strong>适用范围</strong><div>${escapeHtml(item.scope || "-")}</div></div>
                <div><strong>置信度</strong><div>${escapeHtml(String(item.confidence))}</div></div>
                <div><strong>文件路径</strong><div>${escapeHtml(item.path)}</div></div>
              </div>
            </section>
          `,
          ...sections.slice(0, 4).map(
            (section) => `
              <section class="result-card">
                <h4>${escapeHtml(section.heading)}</h4>
                <pre>${escapeHtml(section.body)}</pre>
              </section>
            `,
          ),
        ]);
      }),
      makeButton("确认", async () => {
        const data = await api("/api/rules/action", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "confirm", reason: "通过前端确认" }),
        });
        setResult(`规则已确认：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("停用", async () => {
        const data = await api("/api/rules/action", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "disable", reason: "通过前端停用" }),
        });
        setResult(`规则已停用：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("拒绝", async () => {
        const data = await api("/api/rules/action", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "reject", reason: "通过前端拒绝" }),
        });
        setResult(`规则已拒绝：${item.title}`, data);
        await loadDashboard();
      }),
    );

    container.append(card);
  }
}

function renderProfiles(items) {
  const container = document.getElementById("profiles-list");
  document.getElementById("profiles-count").textContent = String(items.length);
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="card"><div class="meta">当前没有画像文件。</div></div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.name}</h3>
      <div class="meta">
        <div>版本：${item.version}</div>
        <div>路径：${item.path}</div>
      </div>
      <div class="actions"></div>
    `;

    const actions = card.querySelector(".actions");
    actions.append(
      makeButton("查看画像", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        const sections = parseMarkdownSections(data.raw);
        setRichResult(`写作画像：${item.name}`, sections.map(
          (section) => `
            <section class="result-card">
              <h4>${escapeHtml(section.heading)}</h4>
              <pre>${escapeHtml(section.body)}</pre>
            </section>
          `,
        ));
      }),
    );

    container.append(card);
  }
}

function renderFeedback(items) {
  const container = document.getElementById("feedback-list");
  document.getElementById("feedback-count").textContent = String(items.length);
  container.innerHTML = "";

  if (!items.length) {
    container.innerHTML = `<div class="card"><div class="meta">当前没有反馈文件。</div></div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${item.id}</h3>
      <div class="meta">
        <div>反馈类型：${item.feedbackType || "-"}</div>
        <div>关联任务：${item.taskId || "-"}</div>
        <div>关联规则：${(item.relatedRuleIds || []).length}</div>
      </div>
      <div class="actions"></div>
    `;

    const actions = card.querySelector(".actions");
    actions.append(
      makeButton("查看文件", async () => {
        const data = await api(`/api/document?path=${encodeURIComponent(item.path)}`);
        setRichResult(`反馈文件：${item.id}`, [
          `<section class="result-card"><pre>${escapeHtml(data.raw)}</pre></section>`,
        ]);
      }),
      makeButton("学习反馈", async () => {
        const data = await api("/api/feedback/learn", {
          method: "POST",
          body: JSON.stringify({ path: item.path }),
        });
        showFeedbackResult(`反馈学习结果：${item.id}`, data);
        await loadDashboard();
      }),
    );

    container.append(card);
  }
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.dashboard = data;
  document.getElementById("llm-status").textContent = data.llm.enabled ? "已启用" : "未配置，走本地回退";
  document.getElementById("llm-source").textContent = data.llm.source;
  document.getElementById("vault-root").textContent = data.vaultRoot;
  document.getElementById("llm-provider").textContent = data.llm.providerLabel || "OpenAI Codex OAuth";
  document.getElementById("llm-base-url-text").textContent = data.llm.baseUrl || "https://api.openai.com/v1";
  document.getElementById("llm-model-text").textContent = data.llm.model || "gpt-5-codex";
  document.getElementById("llm-updated-at").textContent = data.llm.updatedAt || "未登录";
  renderDashboard();
}

function renderDashboard() {
  if (!state.dashboard) {
    return;
  }

  const filteredMaterials = (state.dashboard.materials || []).filter((item) =>
    matchesSearch([item.title, item.docType, item.audience, item.scenario], state.filters.materials),
  );
  const filteredTasks = (state.dashboard.tasks || []).filter((item) =>
    matchesSearch([item.title, item.docType, item.audience, item.scenario], state.filters.tasks),
  );
  const filteredRules = (state.dashboard.rules || []).filter((item) =>
    (state.filters.ruleStatus === "all" || item.status === state.filters.ruleStatus) &&
    matchesSearch([item.title, item.scope, item.status], state.filters.rules),
  );
  const filteredProfiles = (state.dashboard.profiles || []).filter((item) =>
    matchesSearch([item.name, item.path], state.filters.profiles),
  );
  const filteredFeedback = (state.dashboard.feedback || []).filter((item) =>
    matchesSearch([item.id, item.feedbackType, item.taskId], state.filters.feedback),
  );

  renderMaterials(filteredMaterials);
  renderTaskMaterialOptions(state.dashboard.materials || []);
  renderTasks(filteredTasks);
  renderFeedbackTaskOptions(state.dashboard.tasks || []);
  renderRules(filteredRules);
  renderProfiles(filteredProfiles);
  renderFeedback(filteredFeedback);
}

function formatList(items) {
  if (!items || !items.length) {
    return "<li>无</li>";
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function showTaskResult(title, data) {
  const sections = [];

  if (data.analysis) {
    sections.push(`
      <section class="result-card">
        <h4>任务解析</h4>
        <div class="result-grid">
          <div><strong>文体</strong><div>${escapeHtml(data.analysis.task_type || "-")}</div></div>
          <div><strong>对象</strong><div>${escapeHtml(data.analysis.audience || "-")}</div></div>
          <div><strong>场景</strong><div>${escapeHtml(data.analysis.scenario || "-")}</div></div>
          <div><strong>目标</strong><div>${escapeHtml(data.analysis.goal || "-")}</div></div>
        </div>
        <h4>缺失信息</h4>
        <ul>${formatList(data.analysis.missing_info)}</ul>
      </section>
    `);
  }

  if (data.diagnosis) {
    sections.push(`
      <section class="result-card">
        <h4>写前诊断</h4>
        <div class="result-grid">
          <div><strong>就绪度</strong><div>${escapeHtml(data.diagnosis.readiness || "-")}</div></div>
          <div><strong>下一步</strong><div>${escapeHtml(data.diagnosis.next_action || "-")}</div></div>
        </div>
        <p>${escapeHtml(data.diagnosis.diagnosis_summary || "")}</p>
        <h4>建议结构</h4>
        <ul>${(data.diagnosis.recommended_structure || [])
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.section)}</strong>：${escapeHtml(item.purpose)}<br />必须覆盖：${escapeHtml((item.must_cover || []).join("、") || "无")}</li>`,
          )
          .join("")}</ul>
      </section>
    `);
  }

  if (data.outline) {
    sections.push(`
      <section class="result-card">
        <h4>提纲</h4>
        <ul>${(data.outline.sections || [])
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.heading)}</strong>：${escapeHtml(item.purpose)}<br />关键点：${escapeHtml((item.key_points || []).join("、") || "无")}</li>`,
          )
          .join("")}</ul>
      </section>
    `);
  }

  if (data.draft) {
    sections.push(`
      <section class="result-card">
        <h4>初稿</h4>
        <pre>${escapeHtml(data.draft.draft_markdown || "")}</pre>
      </section>
      <section class="result-card">
        <h4>自检</h4>
        <div class="result-grid">
          <div><strong>优点</strong><ul>${formatList(data.draft.self_review?.strengths || [])}</ul></div>
          <div><strong>风险</strong><ul>${formatList(data.draft.self_review?.risks || [])}</ul></div>
          <div><strong>缺失点</strong><ul>${formatList(data.draft.self_review?.missing_points || [])}</ul></div>
          <div><strong>规则违例</strong><ul>${formatList(data.draft.self_review?.rule_violations || [])}</ul></div>
        </div>
      </section>
    `);
  }

  sections.push(`
    <section class="result-card">
      <h4>原始 JSON</h4>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    </section>
  `);

  setRichResult(title, sections);
}

function showFeedbackResult(title, data) {
  setRichResult(title, [
    `
      <section class="result-card">
        <h4>反馈学习摘要</h4>
        <div class="result-grid">
          <div><strong>类型</strong><div>${escapeHtml(data.analysis?.feedback_type || "-")}</div></div>
          <div><strong>可复用为规则</strong><div>${data.analysis?.is_reusable_rule ? "是" : "否"}</div></div>
        </div>
        <p>${escapeHtml(data.analysis?.feedback_summary || "")}</p>
        <p><strong>建议：</strong>${escapeHtml(data.analysis?.suggested_update || "")}</p>
        <p><strong>候选规则：</strong>${escapeHtml(data.candidateRuleId || "无")}</p>
      </section>
      <section class="result-card">
        <h4>原始 JSON</h4>
        <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </section>
    `,
  ]);
}

document.getElementById("material-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const uploadFile = formData.get("uploadFile");

  if (uploadFile instanceof File && uploadFile.size > 0) {
    payload.uploadName = uploadFile.name;
    payload.uploadBase64 = await fileToBase64(uploadFile);
  }

  try {
    const result = await api("/api/materials/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setRichResult("材料导入完成", [
      `<section class="result-card"><div class="result-grid"><div><strong>materialId</strong><div>${escapeHtml(
        result.materialId,
      )}</div></div><div><strong>路径</strong><div>${escapeHtml(result.path)}</div></div></div></section>`,
    ]);
    form.reset();
    await loadDashboard();
  } catch (error) {
    setResult("材料导入失败", { error: error.message });
  }
});

document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    title: String(formData.get("title") || ""),
    docType: String(formData.get("docType") || ""),
    audience: String(formData.get("audience") || ""),
    scenario: String(formData.get("scenario") || ""),
    priority: String(formData.get("priority") || "medium"),
    targetLength: String(formData.get("targetLength") || ""),
    deadline: String(formData.get("deadline") || ""),
    goal: String(formData.get("goal") || ""),
    targetEffect: String(formData.get("targetEffect") || ""),
    background: String(formData.get("background") || ""),
    facts: String(formData.get("facts") || ""),
    mustInclude: String(formData.get("mustInclude") || ""),
    specialRequirements: String(formData.get("specialRequirements") || ""),
    sourceMaterialIds: formData.getAll("sourceMaterialIds").map(String),
  };

  try {
    const result = await api("/api/tasks/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setRichResult("任务已创建", [
      `<section class="result-card"><div class="result-grid"><div><strong>taskId</strong><div>${escapeHtml(
        result.taskId,
      )}</div></div><div><strong>路径</strong><div>${escapeHtml(result.path)}</div></div></div></section>`,
    ]);
    form.reset();
    await loadDashboard();
  } catch (error) {
    setResult("任务创建失败", { error: error.message });
  }
});

document.getElementById("feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/feedback/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setRichResult("反馈已创建", [
      `<section class="result-card"><div class="result-grid"><div><strong>feedbackId</strong><div>${escapeHtml(
        result.feedbackId,
      )}</div></div><div><strong>路径</strong><div>${escapeHtml(result.path)}</div></div></div></section>`,
    ]);
    form.reset();
    await loadDashboard();
  } catch (error) {
    setResult("反馈创建失败", { error: error.message });
  }
});

document.getElementById("reload-dashboard").addEventListener("click", async () => {
  try {
    await loadDashboard();
    setResult("全局数据已刷新", state.dashboard);
  } catch (error) {
    setResult("刷新失败", { error: error.message });
  }
});

document.getElementById("start-oauth-login").addEventListener("click", async () => {
  try {
    const result = await api("/api/settings/llm/oauth/start", {
      method: "POST",
      body: JSON.stringify({ provider: "openai-codex-oauth" }),
    });
    const popup = window.open(result.authUrl, "writer-oauth-login", "width=680,height=820");
    if (!popup) {
      window.location.href = result.authUrl;
      return;
    }
    setRichResult("OAuth 登录已发起", [
      `
        <section class="result-card">
          <h4>下一步</h4>
          <p>已经弹出 OpenAI Codex 授权窗口。完成授权后，页面会自动刷新模型状态。</p>
          <p><strong>回调地址：</strong>${escapeHtml(result.redirectUri)}</p>
        </section>
      `,
    ]);
  } catch (error) {
    setResult("OAuth 登录发起失败", { error: error.message });
  }
});

document.getElementById("refresh-tasks").addEventListener("click", async () => {
  try {
    const result = await api("/api/refresh/tasks", { method: "POST" });
    setResult("任务参考依据已刷新", result);
    await loadDashboard();
  } catch (error) {
    setResult("刷新任务失败", { error: error.message });
  }
});

document.getElementById("refresh-profile").addEventListener("click", async () => {
  try {
    const result = await api("/api/refresh/profile", { method: "POST" });
    setResult("写作画像已刷新", result);
    await loadDashboard();
  } catch (error) {
    setResult("刷新画像失败", { error: error.message });
  }
});

loadDashboard().catch((error) => {
  setResult("初始化失败", { error: error.message });
});

function bindFilterInput(id, key, eventName = "input") {
  const element = document.getElementById(id);
  element.addEventListener(eventName, () => {
    state.filters[key] = element.value;
    renderDashboard();
  });
}

bindFilterInput("materials-search", "materials");
bindFilterInput("tasks-search", "tasks");
bindFilterInput("rules-search", "rules");
bindFilterInput("rules-status-filter", "ruleStatus", "change");
bindFilterInput("profiles-search", "profiles");
bindFilterInput("feedback-search", "feedback");

window.addEventListener("message", async (event) => {
  const trustedOrigins = new Set([window.location.origin, window.location.origin.replace("127.0.0.1", "localhost"), window.location.origin.replace("localhost", "127.0.0.1")]);
  if (!trustedOrigins.has(event.origin)) {
    return;
  }

  if (event.data?.type === "oauth-complete" && event.data?.ok) {
    await loadDashboard();
    setRichResult("OAuth 登录完成", [
      `
        <section class="result-card">
          <h4>模型状态已刷新</h4>
          <p>OpenAI Codex 登录成功，可直接调用模型的 token 已写入本地配置。</p>
        </section>
      `,
    ]);
  }
});
