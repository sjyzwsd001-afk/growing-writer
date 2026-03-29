export function bindWizard(deps) {
  const {
    state,
    MAX_WIZARD_STEP,
    updateWizardStep,
    validateStepBeforeNext,
    validateWizardSoftGuidance,
    setInfo,
    triggerWizardCheck,
    validateStepBeforeNextHard,
    updateWizardSummary,
    updateWizardActionButtons,
    focusEditorWorkbench,
    updateDocTypeGuidance,
    renderWizardCheckResult,
    renderTemplateChoiceCards,
    renderTemplatePreview,
    updateTemplateAdvancedPanel,
    getWizardTemplatePool,
    renderTemplateSelector,
    updateWizardMaterialSelectionSummary,
    renderWizardBackgroundStatus,
    setTaskBadge,
    createAndRunTask,
    appendLineToWizardTextarea,
  } = deps;

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
      const guidance = validateWizardSoftGuidance(state.wizardStep);
      state.wizardStep += 1;
      updateWizardStep();
      if (guidance) {
        setInfo(guidance);
      }
    }
  });

  document.getElementById("wizard-run-check").addEventListener("click", () => {
    triggerWizardCheck({ autoAdvance: true, silent: false });
  });

  document.getElementById("wizard-go-check").addEventListener("click", () => {
    const blocker = validateStepBeforeNextHard(4);
    if (blocker) {
      setInfo(blocker, true);
      return;
    }
    state.wizardStep = 5;
    updateWizardStep();
    setInfo("已进入检查步骤。");
  });

  document.getElementById("wizard-go-confirm").addEventListener("click", () => {
    if (!state.wizardCheckPassed) {
      document.getElementById("wizard-run-check")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setInfo("请先执行检查并通过，再进入最后确认。", true);
      return;
    }
    state.wizardStep = 6;
    updateWizardStep();
    setInfo("已进入最后确认。");
  });

  document.getElementById("wizard-confirm-check").addEventListener("change", () => {
    if (state.wizardStep >= 6) {
      updateWizardSummary();
    }
    updateWizardActionButtons();
  });

  document.getElementById("goto-editor-panel").addEventListener("click", () => {
    const panel = document.getElementById("editor-panel");
    if (!panel || panel.classList.contains("hidden")) {
      setInfo("当前还没有可编辑正文，请先完成生成。", true);
      return;
    }
    focusEditorWorkbench({ focusDraft: true });
  });

  document.getElementById("wizard-form").addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if ((target.name || target.id) === "docType") {
        updateDocTypeGuidance();
      }
      if (
        state.wizardCheckPassed &&
        ["title", "docType", "background", "facts", "mustInclude", "specialRequirements", "sourceMaterialIds", "templateId", "templateMode", "templateOverrides", "backgroundUpload"].includes(target.name || target.id)
      ) {
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
      if ((target.name || target.id) === "sourceMaterialIds") {
        updateWizardMaterialSelectionSummary();
      }
      if (["background", "facts", "mustInclude", "specialRequirements", "backgroundUpload"].includes(target.name || target.id)) {
        renderWizardBackgroundStatus();
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
    const quickChip = event.target.closest(".wizard-quick-chip");
    if (quickChip instanceof HTMLElement) {
      const fieldName = String(quickChip.dataset.targetField || "").trim();
      const line = String(quickChip.dataset.addLine || "").trim();
      if (fieldName && line && appendLineToWizardTextarea(fieldName, line)) {
        setInfo(`已加入“${line}”。`);
      }
      return;
    }

    const skipButton = event.target.closest("#skip-template-selection");
    if (skipButton) {
      const select = document.getElementById("template-selector");
      if (select instanceof HTMLSelectElement) {
        select.value = "";
      }
      renderTemplateChoiceCards(getWizardTemplatePool(), "");
      renderTemplatePreview();
      updateTemplateAdvancedPanel();
      setInfo("这次已改为不使用模板，系统会按历史材料和规则综合生成。");
      return;
    }

    const skipAndNextButton = event.target.closest("#skip-template-and-next");
    if (skipAndNextButton) {
      const select = document.getElementById("template-selector");
      if (select instanceof HTMLSelectElement) {
        select.value = "";
      }
      renderTemplateChoiceCards(getWizardTemplatePool(), "");
      renderTemplatePreview();
      updateTemplateAdvancedPanel();
      if (state.wizardStep < 4) {
        state.wizardStep = 4;
        updateWizardStep();
      }
      setInfo("已跳过模板，直接进入背景填写。");
      return;
    }

    const button = event.target.closest("button[data-action='pick-template-card']");
    const nextButton = event.target.closest("button[data-action='pick-template-card-next']");
    const actionButton = button || nextButton;
    if (!actionButton) {
      return;
    }
    const templateId = actionButton.dataset.templateId || "";
    const select = document.getElementById("template-selector");
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    select.value = templateId;
    renderTemplateChoiceCards(getWizardTemplatePool(), templateId);
    renderTemplatePreview();
    updateTemplateAdvancedPanel();
    if (nextButton && state.wizardStep < 4) {
      state.wizardStep = 4;
      updateWizardStep();
      setInfo("已采用首推模板，直接进入背景填写。");
      return;
    }
    setInfo(templateId ? "已选中模板卡片。" : "已取消模板。");
  });
}
