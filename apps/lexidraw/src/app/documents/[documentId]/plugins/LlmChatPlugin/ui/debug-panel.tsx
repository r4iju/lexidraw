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
import { useSerializeEditorState } from "../use-serialized-editor-state";
import { ScrollArea } from "~/components/ui/scroll-area";

export const DebugPanel: React.FC = () => {
  const [editor] = useLexicalComposerContext();
  const runtimeTools = useRuntimeTools();
  const { serializeEditorStateWithKeys } = useSerializeEditorState();
  const [selectedToolName, setSelectedToolName] = useState<string>("");
  const [toolArgsJson, setToolArgsJson] = useState<string>("");
  const [toolResult, setToolResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableToolNames = useMemo(() => {
    return Object.keys(runtimeTools).sort();
  }, [runtimeTools]);

  const selectedTool = useMemo(() => {
    if (!selectedToolName) return null;
    return runtimeTools[selectedToolName];
  }, [selectedToolName, runtimeTools]);

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
        `Error parsing arguments JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    try {
      // @ts-expect-error - aintnobodygottimeforthat
      const result = await selectedTool.execute(parsedArgs);
      setToolResult(JSON.stringify(result, null, 2));
      if (result.success && result.content?.updatedEditorStateJson) {
        // Potentially dispatch an update or notify the user if the state was changed
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
    setToolArgsJson(""); // Clear args when tool changes
    setToolResult(null); // Clear previous result
    setError(null); // Clear previous error

    // Pre-fill args with a template based on the tool's parameters
    const tool = runtimeTools[toolName];
    // @ts-expect-error - aintnobodygottimeforthat
    if (tool && tool.parameters && tool.parameters.parameters) {
      // @ts-expect-error - aintnobodygottimeforthat
      const params = tool.parameters.parameters;
      const templateArgs: Record<string, unknown> = {};

      // Check if params is an object and then iterate
      if (typeof params === "object" && params !== null) {
        for (const key in params) {
          if (Object.prototype.hasOwnProperty.call(params, key)) {
            const paramDetails = params[key];
            templateArgs[key] = paramDetails.default ?? ""; // Use default if available, else empty string
          }
        }
      }
      setToolArgsJson(JSON.stringify(templateArgs, null, 2));
    } else {
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
        <ScrollArea className="h-32 p-2 border rounded-md bg-muted">
          <p className="text-sm font-semibold">Description:</p>
          <p className="text-xs mb-2">
            {selectedTool.description || "No description provided."}
          </p>
          <p className="text-sm font-semibold">Parameters Schema:</p>
          <pre className="text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(selectedTool.parameters, null, 2)}
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
          placeholder='{
  "argName": "value"
}'
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
