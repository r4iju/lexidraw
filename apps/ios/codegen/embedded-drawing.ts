import { createHeadlessEditor } from "@lexical/headless";
import { ExcalidrawNode } from "@packages/lexical-nodes";

export const EMBEDDED_DRAWING_STYLE_PATH = new URL(
  "../Sources/DrawingKit/Model/EmbeddedDrawingStyle.swift",
  import.meta.url,
);

/** Read the web's figure sizing and SVG export settings at their source. */
export async function swiftForEmbeddedDrawingStyle(): Promise<string> {
  const style = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/common/figure-box.tsx",
      import.meta.url,
    ),
  ).text();
  const image = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/ExcalidrawNode/ExcalidrawImage.tsx",
      import.meta.url,
    ),
  ).text();
  const naturalScale = /natural\.width \* ([\d.]+)/.exec(style)?.[1];
  const exportPadding = /config:\s*\{\s*padding:\s*(\d+)/.exec(image)?.[1];
  if (!naturalScale || !exportPadding) {
    throw new Error("The web's drawing figure settings changed shape");
  }
  let insertionNodeJSON = "";
  const editor = createHeadlessEditor({
    nodes: [ExcalidrawNode],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      insertionNodeJSON = JSON.stringify(
        ExcalidrawNode.$createExcalidrawNode().exportJSON(),
      );
    },
    { discrete: true },
  );
  return `// Generated from the web's drawingStyle and ExcalidrawImage.\n// Run bun run codegen in apps/ios to update.\nimport LexidrawJSON\n\npublic enum EmbeddedDrawingStyle {\n  public static let insertionNodeJSON = #"${insertionNodeJSON}"#\n  public static let naturalScale = ${naturalScale}\n  public static let exportPadding = ${exportPadding}.0\n  public static let columnRem = FigureStyle.columnRem\n  public static let wideRem = FigureStyle.wideRem\n  public static let minimumShareRem = FigureStyle.minimumShareRem\n  public static let phoneWidth = FigureStyle.phoneWidth\n  public static let captionGap = FigureStyle.captionGap\n  public static let captionFontScale = FigureStyle.captionFontScale\n  public static let captionLineHeight = FigureStyle.captionLineHeight\n}\n`;
}

export const FIGURE_STYLE_PATH = new URL(
  "../Sources/LexidrawJSON/FigureStyle.swift",
  import.meta.url,
);
export async function swiftForFigureStyle(): Promise<string> {
  const css = await Bun.file(
    new URL("../../lexidraw/src/styles/document.css", import.meta.url),
  ).text();
  const measure = /--doc-measure:\s*([\d.]+)rem/.exec(css)?.[1];
  const wide = /--doc-wide:\s*([\d.]+)rem/.exec(css)?.[1];
  const least = /--figure-least:\s*min\(100%,\s*([\d.]+)rem\)/.exec(css)?.[1];
  const phone =
    /@container \(max-width:\s*(\d+)px\)\s*\{\s*\.document-content\s*\{\s*--figure-least: 100%/.exec(
      css,
    )?.[1];
  const caption = /\.document-caption \{([^}]+)\}/.exec(css)?.[1] ?? "";
  const captionGap = /margin:\s*(\d+)px auto 0/.exec(caption)?.[1];
  const captionSize = /font-size:\s*([\d.]+)em/.exec(caption)?.[1];
  const captionLineHeight = /line-height:\s*([\d.]+)/.exec(caption)?.[1];
  if (
    !measure ||
    !wide ||
    !least ||
    !phone ||
    !captionGap ||
    !captionSize ||
    !captionLineHeight
  ) {
    throw new Error("The web's figure CSS changed shape");
  }
  return `// Generated from the web document figure and caption styles.\n// Run bun run codegen in apps/ios to update.\npublic enum FigureStyle {\n  public static let columnRem = ${measure}.0\n  public static let wideRem = ${wide}.0\n  public static let minimumShareRem = ${least}.0\n  public static let phoneWidth = ${phone}.0\n  public static let captionGap = ${captionGap}.0\n  public static let captionFontScale = ${captionSize}\n  public static let captionLineHeight = ${captionLineHeight}\n}\n`;
}
