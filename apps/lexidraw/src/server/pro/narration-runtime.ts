import { start } from "workflow/api";
import { proNarrationWorkflow } from "~/workflows/pro-narration/workflow";
import { serverProNarration } from "./narration-provider";
import "server-only";
import { z } from "zod";
import { drizzle, schema, eq } from "@packages/drizzle";
import { findReadableEntity } from "~/server/entities/readable";
import {
  editorStateToMarkdown,
  parseEditorState,
} from "~/server/documents/markdown";
import { htmlToPlainText } from "@packages/lexical-nodes";
import { createNarrationRouter } from "~/server/api/routers/narration";
import { ProError } from "./ledger";
import { proLedger } from "./runtime";
// No secret, environment flag, or client configuration activates an unverified provider.
export const narrationRouter = createNarrationRouter({
  ledger: proLedger,
  executor: serverProNarration(),
  source: async (account) => {
    const [user] = await drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, account));
    return user?.config?.aiPower?.mode ?? "local";
  },
  read: async (account, documentId) => {
    const entity = await findReadableEntity(drizzle, documentId, account);
    if (!entity) throw new ProError("Document unavailable");
    if (entity.entityType === "document")
      return editorStateToMarkdown(parseEditorState(entity.elements));
    if (entity.entityType === "url") {
      const saved = z
        .object({ distilled: z.object({ contentHtml: z.string() }) })
        .parse(JSON.parse(entity.elements));
      return htmlToPlainText(saved.distilled.contentHtml);
    }
    throw new ProError("This file cannot be narrated");
  },
  dispatch: (account, id) => start(proNarrationWorkflow, [account, id]),
});
