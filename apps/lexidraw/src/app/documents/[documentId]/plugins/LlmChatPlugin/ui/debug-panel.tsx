import type React from "react";
import {
  useState,
  useCallback,
  useMemo,
  useId,
  useRef,
  useEffect,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useRuntimeTools } from "../runtime-tools-provider";
import { useKeyedSerialization } from "../use-serialized-editor-state";
import { ScrollArea } from "~/components/ui/scroll-area";
import { z, type ZodTypeAny } from "zod";

interface ParsedParam {
  name: string;
  type: string;
  description?: string;
  optional: boolean;
  defaultValue?: unknown;
}

export const DebugPanel: React.FC = () => {
  const [editor] = useLexicalComposerContext();
  const runtimeTools = useRuntimeTools();
  const { serializeEditorStateWithKeys } = useKeyedSerialization();
  const [selectedToolName, setSelectedToolName] = useState<string>("");
  const [toolArgsJson, setToolArgsJson] = useState<string>("");
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsedSchemaView, setParsedSchemaView] = useState<string>("");
  const textareaId = useId();

  const availableToolNames = useMemo(() => {
    return Object.keys(runtimeTools).sort();
  }, [runtimeTools]);

  const selectedTool = useMemo(() => {
    if (!selectedToolName) return null;
    return runtimeTools[selectedToolName];
  }, [selectedToolName, runtimeTools]);

  const parseZodSchemaRef = useRef<
    (schema: ZodTypeAny) => ParsedParam[] | string
  >(() => "Not initialized");

  const parseZodSchema = useCallback(
    (schema: ZodTypeAny): ParsedParam[] | string => {
      if (
        !schema ||
        typeof (schema as unknown as { safeParse?: unknown }).safeParse !==
          "function"
      ) {
        return "Not a Zod schema or invalid structure.";
      }

      const unwrap = (s: ZodTypeAny): ZodTypeAny => {
        let current: ZodTypeAny = s;
        // Unwrap common wrappers to get the underlying input type using duck-typing
        for (let i = 0; i < 10; i++) {
          const maybe = current as unknown as {
            unwrap?: () => ZodTypeAny;
            innerType?: () => ZodTypeAny;
          };
          if (typeof maybe.unwrap === "function") {
            current = maybe.unwrap();
            continue;
          }
          if (typeof maybe.innerType === "function") {
            current = maybe.innerType();
            continue;
          }
          break;
        }
        return current;
      };

      const base = unwrap(schema);

      if (base instanceof z.ZodObject) {
        const maybeShape = (base as unknown as { shape?: unknown }).shape;
        const shape: Record<string, ZodTypeAny> =
          typeof maybeShape === "function"
            ? (maybeShape as () => Record<string, ZodTypeAny>)()
            : (maybeShape as Record<string, ZodTypeAny>);

        if (!shape || typeof shape !== "object") {
          return "ZodObject has no shape.";
        }

        const getTypeName = (t: ZodTypeAny): string => {
          const u = unwrap(t);
          if (u instanceof z.ZodString) return "string";
          if (u instanceof z.ZodNumber) return "number";
          if (u instanceof z.ZodBoolean) return "boolean";
          if (u instanceof z.ZodArray) return "array";
          if (u instanceof z.ZodObject) return "object";
          if (u instanceof z.ZodEnum) return "enum";
          if (u instanceof z.ZodUnion) return "union";
          if (u instanceof z.ZodLiteral) return "literal";
          if (u instanceof z.ZodDate) return "date";
          if (u instanceof z.ZodRecord) return "record";
          if (u instanceof z.ZodTuple) return "tuple";
          if (u instanceof z.ZodBigInt) return "bigint";
          if (u instanceof z.ZodSymbol) return "symbol";

          const ctorName =
            (u as unknown as { constructor?: { name?: string } }).constructor
              ?.name ?? "unknown";
          return ctorName;
        };

        const getDefaultValue = (t: ZodTypeAny): unknown => {
          const res = t.safeParse(undefined);
          if (res.success && res.data !== undefined) {
            return res.data;
          }
          return undefined;
        };

        return Object.entries(shape).map(([name, paramSchema]) => {
          return {
            name,
            type: getTypeName(paramSchema),
            description: paramSchema.description,
            optional: paramSchema.isOptional(),
            defaultValue: getDefaultValue(paramSchema),
          };
        });
      }

      const maybeSchema = schema as unknown as { innerType?: () => ZodTypeAny };
      if (typeof maybeSchema.innerType === "function") {
        return parseZodSchemaRef.current(maybeSchema.innerType());
      }

      const baseTypeName =
        (base as unknown as { constructor?: { name?: string } }).constructor
          ?.name ?? "unknown";
      return `Unsupported Zod schema type: ${baseTypeName}`;
    },
    [],
  );

  useEffect(() => {
    parseZodSchemaRef.current = parseZodSchema;
  }, [parseZodSchema]);

  const handleRunTool = useCallback(async () => {
    if (!selectedTool || !selectedToolName) {
      setError("No tool selected.");
      return;
    }
    setError(null);
    setToolResult(null);

    let parsedArgs: unknown;
    try {
      parsedArgs = toolArgsJson.trim() ? JSON.parse(toolArgsJson) : {};
    } catch (e: unknown) {
      setError(
        `Error parsing arguments JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }

    try {
      // @ts-expect-error - tool parameters are typed as `any` for execute
      const result = await selectedTool.execute(parsedArgs);
      setToolResult(JSON.stringify(result, null, 2));
      if (result.success && result.content?.updatedEditorStateJson) {
        console.log("Tool execution resulted in editor state update.");
      }
      if (!result.success && result.error) {
        setError(`Tool execution failed: ${result.error}`);
      }
    } catch (e: unknown) {
      setError(
        `Error executing tool: ${e instanceof Error ? e.message : String(e)}`,
      );
      console.error("Tool execution error:", e);
    }
  }, [selectedTool, selectedToolName, toolArgsJson]);

  const handleLogEditorState = useCallback(() => {
    const editorState = editor.getEditorState();
    const serialized = serializeEditorStateWithKeys(editorState);
    console.log(
      "Current Editor State JSON:",
      serialized,
      JSON.stringify(serialized, null, 2),
    );
    setToolResult(
      "Editor state logged to console. " +
        "See browser developer tools for details.",
    );
    setError(null);
  }, [editor, serializeEditorStateWithKeys]);

  const handleToolSelectionChange = (toolName: string) => {
    setSelectedToolName(toolName);
    setToolArgsJson("");
    setToolResult(null);
    setError(null);

    const tool = runtimeTools[toolName];
    if ((tool as any)?.inputSchema) {
      const parsed = parseZodSchema((tool as any).inputSchema as ZodTypeAny);
      if (Array.isArray(parsed)) {
        const schemaString = parsed
          .map(
            (p) =>
              `- ${p.name} (${p.type})${p.optional ? " (optional)" : ""}: ${
                p.description || "No description"
              }${p.defaultValue !== undefined ? ` (default: ${JSON.stringify(p.defaultValue)})` : ""}`,
          )
          .join("\n");
        setParsedSchemaView(schemaString);

        const templateArgs: Record<string, unknown> = {};
        for (const p of parsed) {
          templateArgs[p.name] = p.defaultValue ?? "";
        }
        setToolArgsJson(JSON.stringify(templateArgs, null, 2));
      } else {
        setParsedSchemaView(parsed); // Show error or unsupported message
        setToolArgsJson("{}");
      }
    } else {
      setParsedSchemaView("No input schema found for this tool.");
      setToolArgsJson("{}");
    }
  };

  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      <h3 className="text-lg font-semibold">Debug Mode</h3>

      <Button onClick={handleLogEditorState} variant="outline">
        Log Editor State JSON
      </Button>

      <Select
        onValueChange={handleToolSelectionChange}
        value={selectedToolName}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a tool to debug" />
        </SelectTrigger>
        <SelectContent>
          {availableToolNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedTool && (
        <ScrollArea className="h-48 p-2 border rounded-md bg-muted">
          <p className="text-sm font-semibold">Description:</p>
          <p className="text-xs mb-2">
            {selectedTool.description || "No description provided."}
          </p>
          <p className="text-sm font-semibold">Input Schema:</p>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {parsedSchemaView}
          </pre>
        </ScrollArea>
      )}

      <div className="flex flex-col space-y-1">
        <label htmlFor={textareaId} className="text-sm font-medium">
          Tool Arguments (JSON):
        </label>
        <Textarea
          id={textareaId}
          value={toolArgsJson}
          onChange={(e) => setToolArgsJson(e.target.value)}
          placeholder='{"argName":"value"}'
          rows={5}
          className="font-mono text-xs"
          disabled={!selectedTool}
        />
      </div>

      <Button onClick={handleRunTool} disabled={!selectedTool}>
        Run Tool: {selectedToolName || "N/A"}
      </Button>

      {error && (
        <div className="p-2 text-sm text-destructive-foreground bg-destructive rounded-md">
          <p className="font-semibold">Error:</p>
          <pre className="whitespace-pre-wrap break-all">{error}</pre>
        </div>
      )}

      {toolResult && (
        <div className="flex-1 flex flex-col space-y-1">
          <p className="text-sm font-medium">Tool Result:</p>
          <ScrollArea className="flex-1 p-2 border rounded-md bg-muted">
            <pre className="text-xs whitespace-pre-wrap break-all">
              {toolResult}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};
