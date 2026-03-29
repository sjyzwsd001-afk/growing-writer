export function bindSettingsActions(deps) {
  const {
    state,
    api,
    toggleMaterialSelection,
    runSettingsAction,
    setSettingsResult,
    clearMaterialSelection,
    loadDashboard,
    selectMaterialsByBucket,
    setInfo,
    bulkAnalyzeMaterials,
    bulkUpdateMaterialRole,
    bulkDeleteMaterials,
  } = deps;

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
    container.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if ((target.dataset.action || "") !== "toggle-material-selection") {
        return;
      }
      toggleMaterialSelection(target.dataset.path || "", target.checked);
    });
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

  document.getElementById("bulk-clear-material-selection").addEventListener("click", () => {
    clearMaterialSelection();
    loadDashboard();
  });

  document.getElementById("bulk-select-materials").addEventListener("click", () => {
    selectMaterialsByBucket("materials");
    setInfo(`已选中当前历史材料 ${Array.isArray(state.dashboard?.materials) ? state.dashboard.materials.length : 0} 份。`);
  });

  document.getElementById("bulk-select-templates").addEventListener("click", () => {
    selectMaterialsByBucket("templates");
    setInfo(`已选中当前模板 ${Array.isArray(state.dashboard?.templates) ? state.dashboard.templates.length : 0} 份。`);
  });

  document.getElementById("bulk-analyze-materials").addEventListener("click", async () => {
    const button = document.getElementById("bulk-analyze-materials");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "处理中...";
    try {
      setInfo(`正在批量重分析 ${state.selectedMaterialPaths.filter(Boolean).length} 份材料，请稍等...`);
      await bulkAnalyzeMaterials();
    } catch (error) {
      setSettingsResult("批量重分析失败", { error: error.message });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  document.getElementById("bulk-mark-template").addEventListener("click", async () => {
    const button = document.getElementById("bulk-mark-template");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "处理中...";
    try {
      await bulkUpdateMaterialRole("template");
    } catch (error) {
      setSettingsResult("批量转模板失败", { error: error.message });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  document.getElementById("bulk-mark-history").addEventListener("click", async () => {
    const button = document.getElementById("bulk-mark-history");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "处理中...";
    try {
      await bulkUpdateMaterialRole("history");
    } catch (error) {
      setSettingsResult("批量转历史材料失败", { error: error.message });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  document.getElementById("bulk-delete-materials").addEventListener("click", async () => {
    const button = document.getElementById("bulk-delete-materials");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "处理中...";
    try {
      await bulkDeleteMaterials();
    } catch (error) {
      setSettingsResult("批量删除失败", { error: error.message });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}
