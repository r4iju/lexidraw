import { $patchStyleText } from "@lexical/selection";
import { $getSelection, type LexicalEditor } from "lexical";
import Link from "next/link";
import { type JSX, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useUnsavedChanges } from "~/hooks/use-unsaved-changes";
import {
  contentFonts,
  documentFont,
  savedFontFamily,
} from "~/lib/document-fonts";
import { useDocumentSettings } from "../../context/document-settings-context";
import { ToolbarMenu } from "./toolbar";

type ShowModal = (
  title: string,
  content: (onClose: () => void) => JSX.Element,
) => void;

const FONT_FAMILY_OPTIONS: [string, string][] = [
  ["sans", "Sans"],
  ["serif", "Serif"],
  ["mono", "Mono"],
  ["Fredoka", "Fredoka"],
  ["M PLUS Rounded 1c", "M PLUS Rounded 1c"],
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

function fontOptions(editor: LexicalEditor): [string, string][] {
  const known = new Set(FONT_FAMILY_OPTIONS.map(([option]) => option));
  const imported = contentFonts(JSON.stringify(editor.getEditorState()))
    .filter((name) => !known.has(name))
    .map((name): [string, string] => [name, name]);
  return [...FONT_FAMILY_OPTIONS, ...imported];
}

function matches(option: string, value: string) {
  const unquoted = value.replace(/^['"]|['"]$/g, "");
  return (
    option === unquoted ||
    savedFontFamily(option) === unquoted ||
    documentFont(option).family === value
  );
}

function applyFont(editor: LexicalEditor, option: string) {
  editor.update(() => {
    const selection = $getSelection();
    if (selection !== null)
      $patchStyleText(selection, { "font-family": savedFontFamily(option) });
  });
}

const DOCUMENT_FACES = [
  ["sans", "Sans"],
  ["serif", "Serif"],
  ["mono", "Mono"],
] as const;

/** Fonts, each shown in its own face, then the document-wide actions. */
export function FontItems({
  editor,
  value,
  showModal,
}: {
  editor: LexicalEditor;
  value: string;
  showModal: ShowModal;
}) {
  const { defaultFontFamily, setDefaultFontFamily, lang, setLang } =
    useDocumentSettings();
  const { markDirty } = useUnsavedChanges();
  const options = fontOptions(editor);
  const current = options.find(([option]) => matches(option, value))?.[0];
  const documentFace = defaultFontFamily || "sans";

  const setDocumentFont = (face: string) => {
    setDefaultFontFamily(face);
    markDirty();
  };

  return (
    <>
      <DropdownMenuRadioGroup value={current ?? ""}>
        {options.map(([option, text]) => {
          const face = documentFont(option);
          return (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              onSelect={() => applyFont(editor, option)}
            >
              {face.href && <link rel="stylesheet" href={face.href} />}
              <span style={{ fontFamily: face.family }}>{text}</span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="pl-8"
        onSelect={() =>
          showModal("Import a Google font", (onClose) => (
            <FontImportModal
              onClose={onClose}
              onImport={(name) => applyFont(editor, name.trim())}
            />
          ))
        }
      >
        Import a Google font…
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="pl-8">
          Document font
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuLabel className="text-muted-foreground">
            The face for text with no font of its own
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={
              DOCUMENT_FACES.some(([face]) => face === documentFace)
                ? documentFace
                : "other"
            }
          >
            {DOCUMENT_FACES.map(([face, label]) => (
              <DropdownMenuRadioItem
                key={face}
                value={face}
                onSelect={() => setDocumentFont(face)}
              >
                <span style={{ fontFamily: documentFont(face).family }}>
                  {label}
                </span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem
              value="other"
              onSelect={() =>
                showModal("Document font", (onClose) => (
                  <DefaultFontImportModal
                    onClose={onClose}
                    onImport={setDocumentFont}
                  />
                ))
              }
            >
              A Google font…
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        className="pl-8"
        onSelect={() =>
          showModal("Document language", (onClose) => (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get("lang");
                setLang(typeof value === "string" && value ? value : null);
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
    </>
  );
}

export function FontDropDown({
  editor,
  value,
  showModal,
  disabled = false,
  className,
}: {
  editor: LexicalEditor;
  value: string;
  showModal: ShowModal;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const label =
    fontOptions(editor).find(([option]) => matches(option, value))?.[1] ??
    value.replace(/^['"]|['"]$/g, "");
  return (
    <ToolbarMenu
      label="Font"
      disabled={disabled}
      className={className}
      contentClassName="min-w-56"
      trigger={<span className="w-24 truncate text-left">{label}</span>}
    >
      <FontItems editor={editor} value={value} showModal={showModal} />
    </ToolbarMenu>
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
      <Label htmlFor="google-font-name" className="font-medium">
        Google font name
      </Label>

      <Input
        value={fontName}
        onChange={(e) => {
          setFontName(e.target.value);
          setError("");
        }}
        id="google-font-name"
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
      <Label htmlFor="google-font-name" className="font-medium">
        Google font name
      </Label>

      <Input
        value={fontName}
        onChange={(e) => {
          setFontName(e.target.value);
          setError("");
        }}
        id="google-font-name"
        placeholder="e.g. Roboto"
        autoFocus
      />
      {error && <Label className="text-xs text-destructive">{error}</Label>}
      <Button type="submit" className="mt-2">
        Use for the document
      </Button>
    </form>
  );
}
