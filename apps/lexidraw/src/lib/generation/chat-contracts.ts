import { z } from "zod";
import { ChatInput } from "./chat";
import { TextBook } from "~/server/pro/contracts";
export const ChatQuote = z.strictObject({
  periodId: z.string(),
  maximum: z.number().int().positive(),
  book: TextBook,
  inputHash: z.string(),
  policy: z.string(),
});
export const ChatAccept = z.strictObject({
  idempotencyKey: z.string().min(1).max(100),
  input: ChatInput,
  quote: ChatQuote,
});
