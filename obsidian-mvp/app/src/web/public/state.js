export const state = {
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
  detailLlmProfileId: "",
  finalizeMeta: null,
  selectedMaterialPaths: [],
  confirmResolver: null,
  isRunningWizardCheck: false,
};

const subscribers = new Set();

function notifySubscribers() {
  subscribers.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("state subscriber failed", error);
    }
  });
}

export function setState(partial) {
  Object.assign(state, partial);
  notifySubscribers();
  return state;
}

export function mutateState(mutator) {
  mutator(state);
  notifySubscribers();
  return state;
}

export function subscribeState(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
