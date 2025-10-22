import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
  type InsertionRelation,
  type InsertionAnchor,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MermaidNode } from "../../../nodes/MermaidNode";
import { ExcalidrawNode } from "../../../nodes/ExcalidrawNode";
import {
  type ExcalidrawConfig,
  type MermaidConfig,
  parseMermaidToExcalidraw,
} from "@excalidraw/mermaid-to-excalidraw";
import type { MermaidToExcalidrawResult } from "@excalidraw/mermaid-to-excalidraw/dist/interfaces";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export const useDiagramTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  /* --------------------------------------------------------------
   * Insert Excalidraw diagram from Mermaid schema
   * --------------------------------------------------------------*/
  const DEFAULT_EXCALIDRAW_CFG: Required<ExcalidrawConfig> = {
    fontSize: 20,
  };

  const DEFAULT_CANVAS_WIDTH: number | "inherit" = "inherit";
  const DEFAULT_CANVAS_HEIGHT: number | "inherit" = "inherit";

  const insertExcalidrawDiagram = tool({
    description: `Parses a Mermaid DSL string into an Excalidraw canvas and inserts it at the desired location.  
          – Fully supports \`MermaidConfig\` (theme variables, edge limits, etc.).  
          – Supports \`ExcalidrawConfig\` (font sizing).`,
    inputSchema: z.object({
      mermaidLines: z
        .array(z.string())
        .describe(
          `A list of Mermaid DSL strings. 
              For ER diagrams, use the \`insertMermaidSvg\` tool instead.
              Example: [
              "graph TD",
              "  User([User]) -->|HTTPS| BrowserUI[Browser UI (Frontend)]",
              "  BrowserUI -->|API Calls| APIServer[API Server (Backend)]",
              "  …"
            ]`,
        )
        .nonempty("Mermaid definition must not be empty."),
      mermaidConfig: z
        .object({}) // allow any shape – full validation happens at runtime merge
        .passthrough()
        .optional(),
      excalidrawConfig: z
        .object({ fontSize: z.number().optional() })
        .passthrough()
        .optional(),
      width: z
        .union([z.number().min(100), z.literal("inherit")])
        .describe(
          "Optional. The width of the Excalidraw canvas. If 'inherit', the width will be determined by the parent container. Minimum width is 100px.",
        )
        .optional()
        .default(DEFAULT_CANVAS_WIDTH),
      height: z
        .union([z.number().min(100), z.literal("inherit")])
        .describe(
          "Optional. The height of the Excalidraw canvas. If 'inherit', the height will be determined by the parent container. Minimum height is 100px.",
        )
        .optional()
        .default(DEFAULT_CANVAS_HEIGHT),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      type ExcalidrawInput = {
        mermaidLines: string[];
        mermaidConfig?: Record<string, unknown>;
        excalidrawConfig?: { fontSize?: number } & Record<string, unknown>;
        width?: number | "inherit";
        height?: number | "inherit";
        relation: InsertionRelation;
        anchor?: InsertionAnchor;
        editorKey?: string;
      };

      const {
        mermaidLines,
        mermaidConfig,
        excalidrawConfig,
        width,
        height,
        relation,
        anchor,
        editorKey,
      } = options as ExcalidrawInput;

      const mermaid = mermaidLines.join("\n");

      // Perform asynchronous parsing before calling insertionExecutor
      let parseResult: MermaidToExcalidrawResult;
      try {
        const mermaidCfg: MermaidConfig = { ...(mermaidConfig ?? {}) };
        parseResult = await parseMermaidToExcalidraw(
          mermaid,
          mermaidCfg as MermaidConfig,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ [insertExcalidrawDiagram] Mermaid parsing failed: ${msg}`,
        );
        return { success: false, error: `Mermaid parsing failed: ${msg}` };
      }

      const excaliCfg: ExcalidrawConfig = {
        ...DEFAULT_EXCALIDRAW_CFG,
        ...(excalidrawConfig ?? {}),
      };
      const elements = convertToExcalidrawElements(parseResult.elements, {
        regenerateIds: true,
        ...excaliCfg,
      });

      const excaliData = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "mermaid‑to‑excalidraw@latest",
        elements,
        files: parseResult.files ?? {},
      });

      // Define the options that the synchronous inserter will receive
      type ExcalidrawInserterPayload = {
        width?: number | "inherit";
        height?: number | "inherit";
        excaliData: string;
        elementsLength: number;
      };

      const inserterOptions: ExcalidrawInserterPayload & {
        relation: InsertionRelation;
        anchor?: InsertionAnchor;
        editorKey?: string;
      } = {
        width,
        height,
        excaliData,
        elementsLength: elements.length,
        relation,
        anchor,
        editorKey,
      };

      return insertionExecutor<ExcalidrawInserterPayload>(
        // Type of specificOptions for the inserter
        "insertExcalidrawDiagram",
        editor,
        inserterOptions, // Pass the processed options
        (resolution, specificOptions, _currentTargetEditor) => {
          // This inserter is now synchronous
          const {
            width: w,
            height: h,
            excaliData: ed,
            elementsLength,
          } = specificOptions;

          const node = new ExcalidrawNode(
            ed,
            false /** keep closed by default */,
            w ?? DEFAULT_CANVAS_WIDTH,
            h ?? DEFAULT_CANVAS_HEIGHT,
          );

          $insertNodeAtResolvedPoint(resolution, node);

          return {
            primaryNodeKey: node.getKey(),
            summaryContext: `Excalidraw diagram from Mermaid (${elementsLength} elements)`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  /* --------------------------------------------------------------
   * Insert Mermaid ER Diagram Tool
   * --------------------------------------------------------------*/
  const insertMermaidDiagram = tool({
    description:
      "Insert a Mermaid diagram using the custom MermaidNode (schema only, no SVG in state).",
    inputSchema: z.object({
      mermaidLines: z.array(z.string()).nonempty(),
      width: z
        .union([z.number().min(100), z.literal("inherit")])
        .optional()
        .default("inherit"),
      height: z
        .union([z.number().min(100), z.literal("inherit")])
        .optional()
        .default("inherit"),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      type BaseOptions = typeof options & { mermaidLines: string[] };
      const base = options as BaseOptions;
      const schema = base.mermaidLines.join("\n");

      // Provide schema to the inserter explicitly.
      const mergedOptions = { ...options, schema } as const;

      // Define options for the inserter.
      type InserterOptions = Omit<
        typeof mergedOptions,
        "relation" | "anchor" | "editorKey"
      > & { schema: string };

      return insertionExecutor(
        "insertMermaidDiagram",
        editor,
        mergedOptions,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { schema, width, height } = specificOptions as InserterOptions;

          const mermaidNode = MermaidNode.$createMermaidNode(
            schema,
            width,
            height,
          );

          $insertNodeAtResolvedPoint(resolution, mermaidNode);

          return {
            primaryNodeKey: mermaidNode.getKey(),
            summaryContext: `Mermaid diagram (${width}×${height})`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  return {
    insertExcalidrawDiagram,
    insertMermaidDiagram,
  };
};
