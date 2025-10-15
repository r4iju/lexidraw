import { $patchStyleText } from "@lexical/selection";
import {
  $getRoot,
  $getSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
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
import { useLexicalStyleUtils } from "../../utils/lexical-style-utils";
import { useDocumentSettings } from "../../context/document-settings-context";
import { useUnsavedChanges } from "~/hooks/use-unsaved-changes";

const FONT_FAMILY_OPTIONS: [string, string][] = [
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
  const [customFonts, setCustomFonts] = useState<[string, string][]>([]);
  const { dropDownActiveClass } = useToolbarUtils();
  const { parseStyleString } = useLexicalStyleUtils();
  const { setDefaultFontFamily } = useDocumentSettings();
  const { markDirty } = useUnsavedChanges();

  const handleClick = useCallback(
    (option: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (selection !== null) {
          $patchStyleText(selection, { [style]: option });
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
          const fontVar = `--font-${fontName.trim().toLowerCase().replace(/\\s+/g, "-")}`;
          const fontValue = `'${fontName.trim()}'`;
          const fontLabel = fontName.trim();

          if (!document.getElementById(fontVar)) {
            // Inject the Google Fonts link
            const link = document.createElement("link");
            link.id = fontVar;
            link.rel = "stylesheet";
            link.href = `https://fonts.googleapis.com/css2?family=${fontName.trim().replace(/\\s+/g, "+")}:wght@400&display=swap`;
            document.head.appendChild(link);

            // Inject the CSS variable
            const style = document.createElement("style");
            style.id = `style-${fontVar}`;
            style.innerHTML = `:root { ${fontVar}: '${fontLabel}', cursive; }`;
            document.head.appendChild(style);
          }
          setCustomFonts((prev) => [...prev, [fontValue, fontLabel]]);
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
          // The effect in document-editor.tsx will handle loading and applying it
        }}
      />
    ));
  }, [showModal, setDefaultFontFamily, markDirty]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      const usedFonts = new Set<string>();
      function hasGetChildren(
        node: LexicalNode,
      ): node is LexicalNode & { getChildren: () => LexicalNode[] } {
        return (
          typeof (node as LexicalNode & { getChildren?: unknown })
            .getChildren === "function"
        );
      }
      function walk(node: LexicalNode) {
        if ($isTextNode(node)) {
          const style = node.getStyle?.();
          if (typeof style === "string") {
            const styleObj = parseStyleString(style);
            let fontFamily = styleObj["font-family"]?.trim();
            if (fontFamily) {
              fontFamily = fontFamily.replace(/^['"]|['"]$/g, "");
              if (
                !FONT_FAMILY_OPTIONS.some(
                  ([val]) => val.replace(/^['"]|['"]$/g, "") === fontFamily,
                )
              ) {
                usedFonts.add(fontFamily);
              }
            }
          }
        }
        if (hasGetChildren(node)) {
          const children = node.getChildren();
          if (children && Array.isArray(children)) {
            children.forEach(walk);
          }
        }
      }
      const rootChildren: LexicalNode[] = $getRoot().getChildren?.() ?? [];
      rootChildren.forEach(walk);
      const newCustomFonts: [string, string][] = [];
      usedFonts.forEach((fontName) => {
        const fontVar = `--font-${fontName.trim().toLowerCase().replace(/\s+/g, "-")}`;
        const fontValue = `'${fontName.trim()}'`;
        const fontLabel = fontName.trim();
        if (!document.getElementById(fontVar)) {
          const link = document.createElement("link");
          link.id = fontVar;
          link.rel = "stylesheet";
          link.href = `https://fonts.googleapis.com/css2?family=${fontLabel.replace(/\s+/g, "+")}:wght@400&display=swap`;
          document.head.appendChild(link);
          const style = document.createElement("style");
          style.id = `style-${fontVar}`;
          style.innerHTML = `:root { ${fontVar}: '${fontLabel}', cursive; }`;
          document.head.appendChild(style);
        }
        newCustomFonts.push([fontValue, fontLabel]);
      });
      setCustomFonts((prev) => {
        const all = [...prev];
        newCustomFonts.forEach(([val, label]) => {
          if (!all.some(([v]) => v === val)) {
            all.push([val, label]);
          }
        });
        return all;
      });
    });
  }, [editor, parseStyleString]);

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
  const found = options.find(([val]) => val === value);
  return found ? found[1].replace(/'/g, "") : value;
}
