import type { EditorThemeClasses } from "lexical";

import "./sticky-editor-theme.css";

import { baseTheme } from "./playground-theme";

const theme: EditorThemeClasses = {
  ...baseTheme,
  paragraph: "StickyEditorTheme__paragraph",
};

export default theme;
