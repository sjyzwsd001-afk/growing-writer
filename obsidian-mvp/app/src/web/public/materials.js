export function bindMaterialImport(deps) {
  const {
    api,
    MATERIAL_IMPORT_API_TIMEOUT_MS,
    fileToBase64,
    loadDashboard,
    setInlineStatus,
    setInfo,
    setSettingsResult,
  } = deps;
  const form = document.getElementById("material-form");
  const modeSelect = form?.querySelector("[name='mode']");
  const hintContainer = document.getElementById("material-mode-hint");
  const materialUploadInput = document.getElementById("material-upload-input");
  const materialUploadSummary = document.getElementById("material-upload-summary");
  const materialUploadTrigger = document.getElementById("material-upload-trigger");
  const submitButton = form?.querySelector("button[type='submit']");

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
      <div><strong>建议导入为：${suggestedMode === "template" ? "正式模板" : "历史材料"}</strong></div>
      <div class="mini">${reason}</div>
      <div class="mini">${usage}</div>
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
      setInlineStatus("material-form-status", "请先填写文档类型。", true);
      setInfo("请先填写文档类型。", true);
      return;
    }

    if (!title && !uploadFiles.length) {
      setInlineStatus("material-form-status", "单文件手工导入时，请填写标题；批量上传时可以留空。", true);
      setInfo("单文件手工导入时，请填写标题；批量上传时可以留空。", true);
      return;
    }

    if (sourceFile && uploadFiles.length > 0) {
      setInlineStatus("material-form-status", "批量上传时，请不要同时填写本地文件路径。", true);
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
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
        submitButton.textContent = "导入中...";
      }
      setInlineStatus("material-form-status", "正在导入并分析材料，请稍等...");
      const result = await api(
        "/api/materials/import",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        MATERIAL_IMPORT_API_TIMEOUT_MS,
      );
      form.reset();
      updateMaterialUploadSummary();
      await loadDashboard();
      const count = Number(result?.count || 0);
      if (count > 1) {
        setInlineStatus(
          "material-form-status",
          mode === "template" ? `已批量导入 ${count} 份正式模板。` : `已批量导入 ${count} 份历史材料。`,
        );
        setInfo(mode === "template" ? `已批量导入 ${count} 份正式模板。` : `已批量导入 ${count} 份历史材料。`);
      } else {
        setInlineStatus("material-form-status", mode === "template" ? "正式模板已导入。" : "历史材料导入完成。");
        setInfo(mode === "template" ? "正式模板已导入。" : "历史材料导入完成。");
      }
      setSettingsResult(mode === "template" ? "正式模板导入完成" : "历史材料导入完成", result, { reveal: false });
    } catch (error) {
      setInlineStatus("material-form-status", `材料导入失败：${error.message}`, true);
      setInfo(`材料导入失败：${error.message}`, true);
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = "导入材料";
      }
    }
  });
}
