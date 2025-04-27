import { $getSelection, $isRangeSelection, LexicalEditor } from "lexical";
import { z } from "zod";
import { tool } from "ai";

interface LexicalNode {
  type: string;
  version: number;
  children?: LexicalNode[];
  format?: string | number;
  indent?: number;
  direction?: "ltr" | "rtl" | null;
  [key: string]: unknown;
}

export const useLexicalTools = (editor: LexicalEditor) => {
  const BaseNodeSchema = z
    .object({
      type: z.string(),
      version: z.number(),
      format: z.union([z.string(), z.number()]).optional(),
      indent: z.number().optional(),
      direction: z.enum(["ltr", "rtl"]).nullable().optional(),
    })
    .catchall(z.unknown());

  const NodeSchema: z.ZodType<LexicalNode> = z.lazy(() =>
    BaseNodeSchema.extend({
      children: z.array(NodeSchema).optional(),
    }),
  );

  const LexicalStateSchema = z
    .object({
      // Define root first using the recursive NodeSchema
      root: NodeSchema
        // Now refine the root node specifically
        .refine(
          (
            data: LexicalNode,
          ): data is LexicalNode & { type: "root"; children: LexicalNode[] } => // Type predicate
            data.type === "root" &&
            Array.isArray(data.children) &&
            data.children.length >= 0, // Allow empty children array for root initially
          {
            message:
              "Root node must have type 'root' and contain children array",
            path: ["root"], // Path points to the root object itself
          },
        ),
    })
    .catchall(z.unknown());

  // Define Zod schemas for tool parameters
  const EditToolParamsSchema = z.object({
    newStateJson: z
      .string()
      .describe(
        "The complete, modified Lexical editor state as a stringified JSON.",
      ),
    instructions: z.string().optional(),
  });

  const InsertToolParamsSchema = z.object({
    text: z.string().describe("The text to insert."),
  });

  // Define a common return type for execute functions
  type ExecuteResult = Promise<{
    success: boolean;
    error?: string;
    details?: unknown;
  }>;

  // Let TypeScript infer the specific types for each tool
  const lexicalLlmTools = {
    editText: tool({
      description:
        "Edit the document based on user instructions. Provide the *entire* modified document state as a single, valid JSON string in the newStateJson argument.",
      parameters: EditToolParamsSchema,
      execute: async ({ newStateJson }): ExecuteResult => {
        console.log(
          `Executing editText tool with newStateJson starting: ${newStateJson.substring(0, 50)}...`,
        );
        try {
          const parsedObject = parseLenientJson(newStateJson);
          const validationResult = LexicalStateSchema.safeParse(parsedObject);
          if (!validationResult.success) {
            const errorMsg =
              "Parsed JSON object failed Lexical schema validation.";
            console.error(errorMsg, validationResult.error.format());
            return {
              success: false,
              error: errorMsg,
              details: validationResult.error.format(),
            };
          }
          const validatedJsonString = JSON.stringify(validationResult.data);
          editor.update(() => {
            const newEditorState = editor.parseEditorState(validatedJsonString);
            editor.setEditorState(newEditorState);
          });
          console.log("editText executed successfully using validated JSON.");
          return { success: true };
        } catch (error: unknown) {
          const errorMsg = "Error processing newStateJson in editText";
          const details =
            error instanceof Error ? error.message : String(error);
          console.error(errorMsg, error, "Input String:", newStateJson);
          return { success: false, error: errorMsg, details };
        }
      },
    }),
    insertText: tool({
      description: "Insert text at the current cursor position.",
      parameters: InsertToolParamsSchema,
      execute: async ({ text }): ExecuteResult => {
        console.log(
          `Executing insertText tool with text: ${text.substring(0, 50)}...`,
        );
        if (!text) {
          console.warn("Attempted to insert empty text.");
          return { success: false, error: "Cannot insert empty text" };
        }
        try {
          let executionError: Error | null = null;
          editor.update(() => {
            try {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                selection.insertText(text);
                console.log(`insertText executed successfully.`);
              } else {
                console.warn("Cannot insert text: No range selection found.");
                executionError = new Error("No range selection found");
              }
            } catch (updateError) {
              executionError =
                updateError instanceof Error
                  ? updateError
                  : new Error(String(updateError));
            }
          });

          if (executionError) {
            throw executionError;
          }

          return { success: true };
        } catch (error: unknown) {
          const errorMsg = "Error executing insertText";
          const details =
            error instanceof Error ? error.message : String(error);
          console.error(errorMsg, error);
          return { success: false, error: errorMsg, details };
        }
      },
    }),
  };

  return { lexicalLlmTools };
};

function parseLenientJson(jsonString: string): unknown {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn("Standard JSON.parse failed. Attempting lenient parsing.", e);
    try {
      const startIndex = jsonString.indexOf("{");
      if (startIndex === -1) throw new Error("Could not find starting '{'");
      let braceCount = 0;
      let endIndex = -1;
      for (let i = startIndex; i < jsonString.length; i++) {
        if (jsonString[i] === "{") braceCount++;
        else if (jsonString[i] === "}") braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
      if (endIndex === -1)
        throw new Error("Could not find matching closing '}'");
      const extractedJson = jsonString.substring(startIndex, endIndex + 1);
      console.log("Extracted JSON substring for parsing:", extractedJson);
      return JSON.parse(extractedJson);
    } catch (lenientError) {
      console.error("Lenient JSON parsing also failed.", lenientError);
      throw new Error(
        `Failed to parse JSON string even with lenient approach: ${jsonString.substring(0, 100)}...`,
      );
    }
  }
}
