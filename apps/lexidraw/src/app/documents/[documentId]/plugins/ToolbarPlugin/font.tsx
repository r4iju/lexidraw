import { $patchStyleText } from "@lexical/selection";
import { $getSelection, type LexicalEditor } from "lexical";
import Link from "next/link";
import { useCallback, useMemo, useState, type JSX } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import useModal from "~/hooks/useModal";
import { useToolbarUtils } from "./utils";
import {
  contentFonts,
  documentFont,
  savedFontFamily,
} from "~/lib/document-fonts";
import { useDocumentSettings } from "../../context/document-settings-context";
import { useUnsavedChanges } from "~/hooks/use-unsaved-changes";

const FONT_FAMILY_OPTIONS: [string, string][] = [
  ["sans", "Sans"],
  ["serif", "Serif"],
  ["mono", "Mono"],
  ["Fredoka", "Fredoka"],
  ["'M PLUS Rounded 1c'", "'M PLUS Rounded 1c'"],
  ["Noto Sans JP", "Noto Sans JP"],
  ["Arial", "Arial"],
  ["Courier New", "Courier New"],
  ["Georgia", "Georgia"],
  ["Times New Roman", "Times New Roman"],
  ["Trebuchet MS", "Trebuchet MS"],
  ["Verdana", "Verdana"],
  ["Yusei Magic", "Yusei Magic"],
  ["Kosugi Maru", "Kosugi Maru"],
  ["Sawarabi Mincho", "Sawarabi Mincho"],
];

const FONT_SIZE_OPTIONS: [string, string][] = [
  ["10px", "10px"],
  ["11px", "11px"],
  ["12px", "12px"],
  ["13px", "13px"],
  ["14px", "14px"],
  ["15px", "15px"],
  ["16px", "16px"],
  ["17px", "17px"],
  ["18px", "18px"],
  ["19px", "19px"],
  ["20px", "20px"],
];

export function FontDropDown({
  editor,
  value,
  style,
  disabled = false,
  className = "",
}: {
  editor: LexicalEditor;
  value: string;
  style: string;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const [modal, showModal] = useModal();
  const [customFonts, setCustomFonts] = useState<[string, string][]>(() =>
    contentFonts(JSON.stringify(editor.getEditorState())).map((name) => [
      name,
      name,
    ]),
  );
  const { dropDownActiveClass } = useToolbarUtils();
  const { setDefaultFontFamily, lang, setLang } = useDocumentSettings();
  const { markDirty } = useUnsavedChanges();

  const handleClick = useCallback(
    (option: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (selection !== null) {
          $patchStyleText(selection, {
            [style]: style === "font-family" ? savedFontFamily(option) : option,
          });
        }
      });
    },
    [editor, style],
  );

  const handleAddFont = useCallback(() => {
    showModal("Import a custom Font", (onClose) => (
      <FontImportModal
        onClose={onClose}
        onImport={(fontName) => {
          setCustomFonts((prev) => [
            ...prev,
            [fontName.trim(), fontName.trim()],
          ]);
        }}
      />
    ));
  }, [showModal]);

  const handleSetDefaultFont = useCallback(() => {
    showModal("Set Default Document Font", (onClose) => (
      <DefaultFontImportModal
        onClose={onClose}
        onImport={(fontName) => {
          setDefaultFontFamily(fontName);
          markDirty();
        }}
      />
    ));
  }, [showModal, setDefaultFontFamily, markDirty]);

  const buttonAriaLabel =
    style === "font-family"
      ? "Formatting options for font family"
      : "Formatting options for font size";

  const allFontOptions = useMemo(
    () => [...FONT_FAMILY_OPTIONS, ...customFonts],
    [customFonts],
  );

  const options = style === "font-family" ? allFontOptions : FONT_SIZE_OPTIONS;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={` text-left h-12 md:h-10 ${className}`}
            variant="outline"
            disabled={disabled}
            aria-label={buttonAriaLabel}
          >
            <span className="text-sm truncate max-w-20">
              {getFontLabel(value, options)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map(([option, text]: [string, string]) => (
            <DropdownMenuItem
              className={`item ${dropDownActiveClass(value === option)} ${
                style === "font-size" ? "fontsize-item" : ""
              }`}
              onClick={() => handleClick(option)}
              key={option}
            >
              <span className="text">{text.replace(/'/g, "")}</span>
            </DropdownMenuItem>
          ))}
          {style === "font-family" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleAddFont}
                className="item font-semibold text-primary"
              >
                + Import Google Font…
              </DropdownMenuItem>
              {(["sans", "serif", "mono"] as const).map((face) => (
                <DropdownMenuItem
                  key={face}
                  onClick={() => {
                    setDefaultFontFamily(face);
                    markDirty();
                  }}
                >
                  Document: {face}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() =>
                  showModal("Document language", (onClose) => (
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = new FormData(event.currentTarget).get(
                          "lang",
                        );
                        setLang(
                          typeof value === "string" && value ? value : null,
                        );
                        markDirty();
                        onClose();
                      }}
                    >
                      <Label htmlFor="document-language">Language</Label>
                      <select
                        id="document-language"
                        name="lang"
                        defaultValue={lang || ""}
                        className="border rounded-md bg-background p-2"
                      >
                        <option value="">Detect from content</option>
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                        <option value="zh-Hans">简体中文</option>
                        <option value="zh-Hant">繁體中文</option>
                        <option value="ko">한국어</option>
                      </select>
                      <Button type="submit">Apply</Button>
                    </form>
                  ))
                }
              >
                Document language…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleSetDefaultFont}
                className="item font-semibold text-primary"
              >
                Set Default Document Font…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {modal}
    </>
  );
}

function FontImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (fontName: string) => void;
}) {
  const [fontName, setFontName] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!fontName.trim()) {
          setError("Font name required");
          return;
        }
        onImport(fontName);
        onClose();
      }}
      className="flex flex-col gap-2"
    >
      <Button variant="link" asChild rel="noopener noreferrer">
        <Link
          className="text-sm pl-0 pr-0"
          target="_blank"
          href="https://fonts.google.com/"
        >
          Find a font on Google Fonts
        </Link>
      </Button>
      <Label className="font-medium">Google Font Name</Label>

      <Input
        value={fontName}
        onChange={(e) => {
          setFontName(e.target.value);
          setError("");
        }}
        placeholder="e.g. Indie Flower"
        autoFocus
      />
      {error && <Label className="text-xs text-destructive">{error}</Label>}
      <Button type="submit" className="mt-2">
        Import
      </Button>
    </form>
  );
}

function DefaultFontImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (fontName: string) => void;
}) {
  const [fontName, setFontName] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!fontName.trim()) {
          setError("Font name required");
          return;
        }
        onImport(fontName);
        onClose();
      }}
      className="flex flex-col gap-2"
    >
      <Button variant="link" asChild rel="noopener noreferrer">
        <Link
          className="text-sm pl-0 pr-0"
          target="_blank"
          href="https://fonts.google.com/"
        >
          Find a font on Google Fonts
        </Link>
      </Button>
      <Label className="font-medium">Google Font Name for Document</Label>

      <Input
        value={fontName}
        onChange={(e) => {
          setFontName(e.target.value);
          setError("");
        }}
        placeholder="e.g. Roboto"
        autoFocus
      />
      {error && <Label className="text-xs text-destructive">{error}</Label>}
      <Button type="submit" className="mt-2">
        Set as Default
      </Button>
    </form>
  );
}

function getFontLabel(value: string, options: [string, string][]) {
  const found = options.find(
    ([val]) =>
      val === value ||
      savedFontFamily(val) === value ||
      documentFont(val).family === value,
  );
  return found ? found[1].replace(/'/g, "") : value;
}
