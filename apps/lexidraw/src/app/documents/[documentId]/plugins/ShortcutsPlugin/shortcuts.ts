import { IS_APPLE } from "@lexical/utils";

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
