export const DEFAULT_SETTINGS = {
  disableBeforeInput: false,
  emptyEditor: false,
  autocomplete: false,
  chat: false,
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
  showTreeView: false,
};

export type SettingName = keyof typeof DEFAULT_SETTINGS;

export type Settings = typeof DEFAULT_SETTINGS;
