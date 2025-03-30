import { IS_APPLE } from "@lexical/utils";

export const SHORTCUTS = Object.freeze({
  // (Ctrl|⌘) + (Alt|Option) + <key> shortcuts
  NORMAL: IS_APPLE ? "⌘+Opt+0" : "Ctrl+Alt+0",
  HEADING1: IS_APPLE ? "⌘+Opt+1" : "Ctrl+Alt+1",
  HEADING2: IS_APPLE ? "⌘+Opt+2" : "Ctrl+Alt+2",
  HEADING3: IS_APPLE ? "⌘+Opt+3" : "Ctrl+Alt+3",
  BULLET_LIST: IS_APPLE ? "⌘+Opt+4" : "Ctrl+Alt+4",
  NUMBERED_LIST: IS_APPLE ? "⌘+Opt+5" : "Ctrl+Alt+5",
  CHECK_LIST: IS_APPLE ? "⌘+Opt+6" : "Ctrl+Alt+6",
  CODE_BLOCK: IS_APPLE ? "⌘+Opt+C" : "Ctrl+Alt+C",
  QUOTE: IS_APPLE ? "⌘+Opt+Q" : "Ctrl+Alt+Q",

  // (Ctrl|⌘) + Shift + <key> shortcuts
  INCREASE_FONT_SIZE: IS_APPLE ? "⌘+Shift+." : "Ctrl+Shift+.",
  DECREASE_FONT_SIZE: IS_APPLE ? "⌘+Shift+," : "Ctrl+Shift+,",
  INSERT_CODE_BLOCK: IS_APPLE ? "⌘+Shift+C" : "Ctrl+Shift+C",
  STRIKETHROUGH: IS_APPLE ? "⌘+Shift+S" : "Ctrl+Shift+S",
  LOWERCASE: IS_APPLE ? "⌘+Shift+1" : "Ctrl+Shift+1",
  UPPERCASE: IS_APPLE ? "⌘+Shift+2" : "Ctrl+Shift+2",
  CAPITALIZE: IS_APPLE ? "⌘+Shift+3" : "Ctrl+Shift+3",
  CENTER_ALIGN: IS_APPLE ? "⌘+Shift+E" : "Ctrl+Shift+E",
  JUSTIFY_ALIGN: IS_APPLE ? "⌘+Shift+J" : "Ctrl+Shift+J",
  LEFT_ALIGN: IS_APPLE ? "⌘+Shift+L" : "Ctrl+Shift+L",
  RIGHT_ALIGN: IS_APPLE ? "⌘+Shift+R" : "Ctrl+Shift+R",

  // (Ctrl|⌘) + <key> shortcuts
  SUBSCRIPT: IS_APPLE ? "⌘+," : "Ctrl+,",
  SUPERSCRIPT: IS_APPLE ? "⌘+." : "Ctrl+.",
  INDENT: IS_APPLE ? "⌘+]" : "Ctrl+]",
  OUTDENT: IS_APPLE ? "⌘+[" : "Ctrl+[",
  CLEAR_FORMATTING: IS_APPLE ? "⌘+\\" : "Ctrl+\\",
  REDO: IS_APPLE ? "⌘+Shift+Z" : "Ctrl+Y",
  UNDO: IS_APPLE ? "⌘+Z" : "Ctrl+Z",
  BOLD: IS_APPLE ? "⌘+B" : "Ctrl+B",
  ITALIC: IS_APPLE ? "⌘+I" : "Ctrl+I",
  UNDERLINE: IS_APPLE ? "⌘+U" : "Ctrl+U",
  INSERT_LINK: IS_APPLE ? "⌘+K" : "Ctrl+K",
});

export function useShortcuts() {
  const controlOrMeta = (metaKey: boolean, ctrlKey: boolean): boolean => {
    return IS_APPLE ? metaKey : ctrlKey;
  };

  const isFormatParagraph = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;

    return (
      (code === "Numpad0" || code === "Digit0") &&
      !shiftKey &&
      altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatHeading = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    const keyNumber = code[code.length - 1] as string;

    return (
      ["1", "2", "3"].includes(keyNumber) &&
      !shiftKey &&
      altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatBulletList = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad4" || code === "Digit4") &&
      !shiftKey &&
      altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatNumberedList = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad5" || code === "Digit5") &&
      !shiftKey &&
      altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatCheckList = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad6" || code === "Digit6") &&
      !shiftKey &&
      altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatCode = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyC" && !shiftKey && altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isFormatQuote = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyQ" && !shiftKey && altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isLowercase = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad1" || code === "Digit1") &&
      shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isUppercase = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad2" || code === "Digit2") &&
      shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isCapitalize = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      (code === "Numpad3" || code === "Digit3") &&
      shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isStrikeThrough = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyS" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isIndent = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "BracketRight" &&
      !shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isOutdent = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "BracketLeft" &&
      !shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isCenterAlign = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyE" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isLeftAlign = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyL" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isRightAlign = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyR" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isJustifyAlign = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyJ" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isSubscript = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "Comma" &&
      !shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isSuperscript = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "Period" &&
      !shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isInsertCodeBlock = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyC" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isIncreaseFontSize = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "Period" &&
      shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isDecreaseFontSize = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "Comma" && shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isClearFormatting = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "Backslash" &&
      !shiftKey &&
      !altKey &&
      controlOrMeta(metaKey, ctrlKey)
    );
  };

  const isInsertLink = (event: KeyboardEvent): boolean => {
    const { code, shiftKey, altKey, metaKey, ctrlKey } = event;
    return (
      code === "KeyK" && !shiftKey && !altKey && controlOrMeta(metaKey, ctrlKey)
    );
  };

  return {
    isFormatParagraph,
    isFormatHeading,
    isFormatBulletList,
    isFormatNumberedList,
    isFormatCheckList,
    isFormatCode,
    isFormatQuote,
    isLowercase,
    isUppercase,
    isCapitalize,
    isStrikeThrough,
    isIndent,
    isOutdent,
    isCenterAlign,
    isLeftAlign,
    isRightAlign,
    isJustifyAlign,
    isSubscript,
    isSuperscript,
    isInsertCodeBlock,
    isIncreaseFontSize,
    isDecreaseFontSize,
    isClearFormatting,
    isInsertLink,
  };
}
