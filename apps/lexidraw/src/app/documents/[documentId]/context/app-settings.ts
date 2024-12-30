export const DEFAULT_SETTINGS = {
  disableBeforeInput: false,
  emptyEditor: false,
  isAutocomplete: false,
  isCharLimit: false,
  isCharLimitUtf8: false,
  isCollab: false,
  isMaxLength: false,
  isRichText: true,
  measureTypingPerf: false,
  shouldPreserveNewLinesInMarkdown: true,
  shouldUseLexicalContextMenu: true,
  showNestedEditorTreeView: false,
  showTableOfContents: true,
  showTreeView: true,
  tableCellBackgroundColor: true,
  tableCellMerge: true,
  isLlm: true,
  llmModel: "SmolLM2-135M-Instruct-q0f32-MLC",
  llmTemperature: 0.3,
  llmMaxTokens: 24,
} as const;

// These are mutated in setupEnv
export const INITIAL_SETTINGS: Record<SettingName, boolean | string | number> =
  {
    ...DEFAULT_SETTINGS,
  };

export type SettingName = keyof typeof DEFAULT_SETTINGS;

export type Settings = typeof INITIAL_SETTINGS;
