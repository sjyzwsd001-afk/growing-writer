const state = {
  dashboard: null,
};

const resultViewer = document.getElementById("result-viewer");

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
  resultViewer.textContent = `${title}\n\n${body}`;
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
      makeButton("查看文件", async () => {
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
        setResult(`任务文件：${item.title}`, data.raw);
      }),
      makeButton("跑诊断", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "diagnose" }),
        });
        setResult(`任务诊断：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("跑提纲", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "outline" }),
        });
        setResult(`任务提纲：${item.title}`, data);
        await loadDashboard();
      }),
      makeButton("跑初稿", async () => {
        const data = await api("/api/tasks/run", {
          method: "POST",
          body: JSON.stringify({ path: item.path, action: "draft" }),
        });
        setResult(`任务初稿：${item.title}`, data);
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
        setResult(`规则文件：${item.title}`, data.raw);
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
        setResult(`反馈文件：${item.id}`, data.raw);
      }),
      makeButton("学习反馈", async () => {
        const data = await api("/api/feedback/learn", {
          method: "POST",
          body: JSON.stringify({ path: item.path }),
        });
        setResult(`反馈学习结果：${item.id}`, data);
        await loadDashboard();
      }),
    );

    container.append(card);
  }
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.dashboard = data;
  document.getElementById("llm-status").textContent = data.llm_enabled ? "已启用" : "未配置，走本地回退";
  document.getElementById("vault-root").textContent = data.vaultRoot;
  renderMaterials(data.materials || []);
  renderTasks(data.tasks || []);
  renderRules(data.rules || []);
  renderFeedback(data.feedback || []);
}

document.getElementById("material-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = Object.fromEntries(formData.entries());
  try {
    const result = await api("/api/materials/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setResult("材料导入完成", result);
    event.currentTarget.reset();
    await loadDashboard();
  } catch (error) {
    setResult("材料导入失败", { error: error.message });
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
