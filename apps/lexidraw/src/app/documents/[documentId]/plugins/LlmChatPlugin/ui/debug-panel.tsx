import React, { useState, useCallback, useMemo } from "react";
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
import { ZodTypeAny } from "zod";

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

  const availableToolNames = useMemo(() => {
    return Object.keys(runtimeTools).sort();
  }, [runtimeTools]);

  const selectedTool = useMemo(() => {
    if (!selectedToolName) return null;
    return runtimeTools[selectedToolName];
  }, [selectedToolName, runtimeTools]);

  const parseZodSchema = useCallback(
    (schema: ZodTypeAny): ParsedParam[] | string => {
      if (!schema || !schema._def) {
        return "Not a Zod schema or invalid structure.";
      }

      if (schema._def.typeName === "ZodObject") {
        // @ts-expect-error - _def.schema is present for ZodEffects
        const shape = schema.shape as Record<string, ZodTypeAny>;
        if (!shape) return "ZodObject has no shape.";

        return Object.entries(shape).map(([name, paramSchema]) => {
          let defaultValue = undefined;
          if (paramSchema._def.defaultValue) {
            try {
              defaultValue = paramSchema._def.defaultValue();
            } catch {
              // ignore if default value is a function that errors without context
            }
          }
          return {
            name,
            type: paramSchema._def.typeName,
            description: paramSchema.description,
            optional: paramSchema.isOptional(),
            defaultValue: defaultValue,
          };
        });
      } else if (schema._def.typeName === "ZodEffects") {
        // Handle schemas wrapped with .transform()
        return parseZodSchema(schema._def.schema as ZodTypeAny);
      }
      // Add more handlers for other Zod types if needed (e.g., ZodArray, ZodUnion)
      return `Unsupported Zod schema type: ${schema._def.typeName}`;
    },
    [],
  );

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
    if (tool && tool.parameters) {
      const parsed = parseZodSchema(tool.parameters as ZodTypeAny);
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
        parsed.forEach((p) => {
          templateArgs[p.name] = p.defaultValue ?? "";
        });
        setToolArgsJson(JSON.stringify(templateArgs, null, 2));
      } else {
        setParsedSchemaView(parsed); // Show error or unsupported message
        setToolArgsJson("{}");
      }
    } else {
      setParsedSchemaView("No parameters schema found for this tool.");
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
          <p className="text-sm font-semibold">Parameters:</p>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {parsedSchemaView}
          </pre>
        </ScrollArea>
      )}

      <div className="flex flex-col space-y-1">
        <label htmlFor="tool-args" className="text-sm font-medium">
          Tool Arguments (JSON):
        </label>
        <Textarea
          id="tool-args"
          value={toolArgsJson}
          onChange={(e) => setToolArgsJson(e.target.value)}
          placeholder='{\n  "argName": "value"\n}'
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
          <label className="text-sm font-medium">Tool Result:</label>
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
