import { $isCodeNode } from "@lexical/code";
import { $getNearestNodeFromDOMNode, type LexicalEditor } from "lexical";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useDebounce } from "~/lib/client-utils";
import { getCodeLanguageFriendlyName } from "../code-language";

const parsers = {
  css: { parser: "css", load: () => import("prettier/parser-postcss") },
  html: { parser: "html", load: () => import("prettier/parser-html") },
  javascript: { parser: "babel", load: () => import("prettier/parser-babel") },
  markdown: {
    parser: "markdown",
    load: () => import("prettier/parser-markdown"),
  },
  typescript: {
    parser: "typescript",
    load: () => import("prettier/parser-typescript"),
  },
};
/** Whether Prettier can format code in `lang`, a normalized language ID. */
export function canFormat(lang: string) {
  return Object.hasOwn(parsers, lang);
}
type Status = { kind: "idle" | "success" } | { kind: "error"; message: string };
export function PrettierButton({
  lang,
  editor,
  getCodeDOMNode,
}: {
  lang: string;
  editor: LexicalEditor;
  getCodeDOMNode: () => HTMLElement | null;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const { run: clearSuccess } = useDebounce(
    () => setStatus({ kind: "idle" }),
    1000,
  );
  async function formatCode() {
    const dom = getCodeDOMNode();
    if (!dom || !canFormat(lang)) return;
    // The membership check above restricts the language to a supported parser.
    const parser = parsers[lang as keyof typeof parsers];
    const content = editor.read("latest", () => {
      const node = $getNearestNodeFromDOMNode(dom);
      return $isCodeNode(node) ? node.getTextContent() : "";
    });
    try {
      const [{ format }, plugin, estree] = await Promise.all([
        import("prettier/standalone"),
        parser.load(),
        import("prettier/plugins/estree"),
      ]);
      const formatted = await format(content, {
        parser: parser.parser,
        plugins: [plugin.default, estree.default],
      });
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(dom);
        // Do not overwrite text typed while the formatter was loading.
        if ($isCodeNode(node) && node.getTextContent() === content)
          node.select(0).insertText(formatted.trimEnd());
      });
      setStatus({ kind: "success" });
      clearSuccess();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs pointer-coarse:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
      aria-label="Format code"
      // Unlike `disabled`, this keeps the reason below reachable by pointer
      // and keyboard.
      aria-disabled={!canFormat(lang)}
      title={
        !canFormat(lang)
          ? `${getCodeLanguageFriendlyName(lang) || "Plain text"} cannot be formatted`
          : status.kind === "error"
            ? status.message
            : "Format code with Prettier"
      }
      onClick={formatCode}
    >
      {status.kind === "success"
        ? "Formatted"
        : status.kind === "error"
          ? "Format failed"
          : "Format"}
    </Button>
  );
}
