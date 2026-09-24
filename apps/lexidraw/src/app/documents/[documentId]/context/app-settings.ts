export const DEFAULT_SETTINGS = {
  autocomplete: false,
  showNestedEditorTreeView: false,
};

export type SettingName = keyof typeof DEFAULT_SETTINGS;

export type Settings = typeof DEFAULT_SETTINGS;
