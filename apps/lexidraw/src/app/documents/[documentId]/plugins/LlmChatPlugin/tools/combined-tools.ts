import { tool } from "ai";
import { z, type ZodTypeAny } from "zod";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { RuntimeToolMap } from "../../../context/llm-context";

export const useCombinedTools = (individualTools: RuntimeToolMap) => {
  const [editor] = useLexicalComposerContext();

  const toolCallSchemas = Object.entries(individualTools)
    .filter(([, tool]) => tool?.inputSchema)
    .map(([toolName, tool]) => {
      return z.object({
        toolName: z.literal(toolName),
        args: (tool as any).inputSchema as ZodTypeAny,
      });
    });

  if (toolCallSchemas.length === 0) {
    // Return a placeholder tool if no tools are provided
    // This can happen if the workflow is initialized without any tools
    return {
      combinedTools: tool({
        description: "No tools available for combination.",
        inputSchema: z.object({}),
        execute: async () => ({
          success: false,
          error: "No tools were provided to combinedTools.",
        }),
      }),
    };
  }

  const combinedTools = tool({
    description: `Executes a sequence of other tool calls sequentially. 
        Useful for batching independent or safely sequential operations to reduce latency. 
        Stops execution if any step fails.
        Should prefferably be used when inserting multiple similar nodes.
        `,
    inputSchema: z.object({
      calls: z
        .array(
          z.discriminatedUnion(
            "toolName",
            // @ts-expect-error - TODO: fix this
            toolCallSchemas as [ZodTypeAny, ...ZodTypeAny[]],
          ),
        )
        .min(1)
        .describe(
          "An array of tool calls to execute in order. Each object needs 'toolName' and 'args'.",
        ),
    }),
    execute: async ({ calls }) => {
      const results: {
        summary: string;
        stateJson?: Record<string, unknown>;
      }[] = [];
      let lastStateJson: Record<string, unknown> | undefined;

      try {
        console.log(
          `[combinedTools] Starting execution of ${calls.length} calls.`,
        );

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          if (!call) {
            throw new Error(`[combinedTools] Invalid call at index ${i}`);
          }
          const { toolName, args } = call as {
            toolName: string;
            args: Record<string, unknown>;
          };

          console.log(
            `[combinedTools] Executing step ${i + 1}: ${toolName}`,
            args,
          );

          const subTool = individualTools[toolName]; // Corrected: individualTools should be in scope here

          if (!subTool) {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' not found. Available tools: ${Object.keys(individualTools).join(", ")}`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Check if execute is a function before calling
          if (typeof subTool.execute !== "function") {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' does not have a callable execute function.`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Validate via Zod input schema if available; otherwise pass-through
          const schema: ZodTypeAny | undefined = (subTool as any).inputSchema as
            | ZodTypeAny
            | undefined;
          const validatedArgs = schema ? schema.parse(args) : (args as any);
          // Execute expects the input directly in v5
          // @ts-expect-error execute is provided by tool
          const result = await subTool.execute(validatedArgs);

          if (!result.success) {
            const errorMsg = `[combinedTools] Error on step ${i + 1} (${toolName}): ${result.error ?? "Unknown error"}`;
            console.error(errorMsg);
            return {
              success: false,
              error: `Step ${i + 1} (${toolName}) failed: ${result.error ?? "Unknown error"}`,
              content: result.content,
            };
          }

          // Store summary and potentially update last state
          const summary =
            result.content?.summary ?? `${toolName} executed successfully.`;
          results.push({ summary });
          lastStateJson =
            result.content?.updatedEditorStateJson ?? lastStateJson;

          console.log(
            `[combinedTools] Step ${i + 1} (${toolName}) succeeded: ${summary}`,
          );
        } // End loop

        // If all calls succeeded
        const combinedSummary = results
          .map((r, idx) => `Step ${idx + 1}: ${r.summary}`)
          .join("\n");

        // Capture final state if not captured by the last step
        if (lastStateJson === undefined && calls.length > 0) {
          editor.read(() => {
            // Use 'editor' via closure from RuntimeToolsProvider
            lastStateJson = editor
              .getEditorState()
              .toJSON() as unknown as Record<string, unknown>;
          });
        }

        console.log(
          `✅ [combinedTools] All ${calls.length} steps executed successfully.`,
        );
        return {
          success: true,
          content: {
            summary: `Combined execution successful:\n${combinedSummary}`,
            updatedEditorStateJson: lastStateJson,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ [combinedTools] Unexpected error during execution:`,
          errorMsg,
        );
        return {
          success: false,
          error: `Combined execution failed: ${errorMsg}`,
        };
      }
    },
  });

  return { combinedTools };
};
