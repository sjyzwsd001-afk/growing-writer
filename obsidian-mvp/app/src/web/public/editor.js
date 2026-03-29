export function bindEditorActions(deps) {
  const {
    state,
    captureDraftSelection,
    setInfo,
    summarizeDraftChanges,
    renderRepurposeOutputs,
    updateEditorActionStates,
    collectCurrentAnnotation,
    confirmDestructiveAction,
    renderPendingAnnotations,
    refillAnnotationForm,
    focusAnnotationInDraft,
    api,
    setSettingsResult,
    renderFeedbackLearnResult,
    renderFinalizeReview,
    loadDashboard,
    saveCurrentDraft,
    setTaskBadge,
    generateRepurposeSummary,
    generateLeaderBrief,
    generateRepurposeOutline,
    setRepurposeBox,
    updateRepurposeGenerationStatus,
    setRepurposeCopyStatus,
    copyText,
    submitFeedbackAndRegenerate,
    renderWorkflowStageTracker,
    updateEditorNextGuide,
  } = deps;

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
    renderRepurposeOutputs();
    updateEditorActionStates();
  });

  document.getElementById("add-annotation").addEventListener("click", () => {
    try {
      collectCurrentAnnotation({ strictSelection: true, persist: true });
      setInfo("已加入本轮批注清单。");
    } catch (error) {
      setInfo(error.message, true);
    }
  });

  document.getElementById("clear-annotations").addEventListener("click", async () => {
    if (!state.pendingAnnotations.length) {
      return;
    }
    if (!(await confirmDestructiveAction("确认清空本轮批注清单吗？这会移除当前未提交的所有批注。"))) {
      return;
    }
    state.pendingAnnotations = [];
    state.activeAnnotationIndex = -1;
    renderPendingAnnotations();
    setInfo("已清空本轮批注清单。");
  });

  document.getElementById("annotation-list").addEventListener("click", async (event) => {
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
      if (!(await confirmDestructiveAction("确认删除这条批注吗？"))) {
        return;
      }
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
      updateEditorActionStates();
    }
  });

  ["feedback-location", "feedback-reason", "feedback-comment"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      updateEditorActionStates();
    });
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
        renderFinalizeReview();
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

  document.getElementById("generate-brief-summary").addEventListener("click", () => {
    const container = document.getElementById("repurpose-summary");
    if (!container) {
      return;
    }
    const draft = String(document.getElementById("draft-editor")?.value || "").trim();
    setRepurposeBox(container, generateRepurposeSummary(draft));
    updateRepurposeGenerationStatus();
    setRepurposeCopyStatus("");
    setInfo("已生成一版摘要。");
  });

  document.getElementById("generate-leader-brief").addEventListener("click", () => {
    const container = document.getElementById("repurpose-leader-brief");
    if (!container) {
      return;
    }
    const draft = String(document.getElementById("draft-editor")?.value || "").trim();
    setRepurposeBox(container, generateLeaderBrief(draft));
    updateRepurposeGenerationStatus();
    setRepurposeCopyStatus("");
    setInfo("已生成一版领导摘要。");
  });

  document.getElementById("generate-brief-outline").addEventListener("click", () => {
    const container = document.getElementById("repurpose-outline");
    if (!container) {
      return;
    }
    const draft = String(document.getElementById("draft-editor")?.value || "").trim();
    setRepurposeBox(container, generateRepurposeOutline(draft));
    updateRepurposeGenerationStatus();
    setRepurposeCopyStatus("");
    setInfo("已生成一版提纲。");
  });

  document.getElementById("generate-all-briefs").addEventListener("click", () => {
    const draft = String(document.getElementById("draft-editor")?.value || "").trim();
    if (!draft) {
      setInfo("请先生成或填写正文。", true);
      return;
    }
    setRepurposeBox(document.getElementById("repurpose-summary"), generateRepurposeSummary(draft));
    setRepurposeBox(document.getElementById("repurpose-leader-brief"), generateLeaderBrief(draft));
    setRepurposeBox(document.getElementById("repurpose-outline"), generateRepurposeOutline(draft));
    updateRepurposeGenerationStatus();
    setRepurposeCopyStatus("");
    setInfo("已一键生成摘要、领导摘要和提纲。");
  });

  document.getElementById("copy-brief-summary").addEventListener("click", async () => {
    try {
      await copyText(document.getElementById("repurpose-summary")?.textContent || "", "摘要已复制。");
      setInfo("摘要已复制。");
      setRepurposeCopyStatus("摘要已复制。");
    } catch (error) {
      setRepurposeCopyStatus(error.message || "摘要复制失败。");
      setInfo(error.message, true);
    }
  });

  document.getElementById("copy-brief-outline").addEventListener("click", async () => {
    try {
      await copyText(document.getElementById("repurpose-outline")?.textContent || "", "提纲已复制。");
      setInfo("提纲已复制。");
      setRepurposeCopyStatus("提纲已复制。");
    } catch (error) {
      setRepurposeCopyStatus(error.message || "提纲复制失败。");
      setInfo(error.message, true);
    }
  });

  document.getElementById("copy-leader-brief").addEventListener("click", async () => {
    try {
      await copyText(document.getElementById("repurpose-leader-brief")?.textContent || "", "领导摘要已复制。");
      setInfo("领导摘要已复制。");
      setRepurposeCopyStatus("领导摘要已复制。");
    } catch (error) {
      setRepurposeCopyStatus(error.message || "领导摘要复制失败。");
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
      renderFinalizeReview();
    } catch (error) {
      setTaskBadge("再生成失败", true);
      setInfo(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "提交反馈并再次生成";
    }
  });

  document.getElementById("finalize-draft").addEventListener("click", async () => {
    if (!(await confirmDestructiveAction("确认直接定稿吗？当前正文会写回任务文件，并作为本轮最终版本。"))) {
      return;
    }
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
      state.finalizeMeta = { finalizedAt: new Date().toISOString() };
      setTaskBadge("已定稿");
      renderWorkflowStageTracker();
      updateEditorNextGuide("finalized");
      setInfo("已定稿并写入任务文件。");
      renderFinalizeReview();
      await loadDashboard();
    } catch (error) {
      setTaskBadge("定稿失败", true);
      setInfo(error.message, true);
    }
  });
}
