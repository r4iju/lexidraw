import "server-only";
import { start } from "workflow/api";
import { drizzle, schema, eq } from "@packages/drizzle";
import { createAgentRouter } from "~/server/api/routers/pro-agent";
import { proAgentWorkflow } from "~/workflows/pro-agent/workflow";
import { proLedger } from "./runtime";
import { generatedImages } from "./image-runtime";
import { createAgentImageStore } from "~/server/entities/agent-image-store";
import { SqlAgentDocuments } from "./agent-documents";
import { revalidateEntities } from "~/server/api/entity-cache";
import type { ProAgentOperation } from "./agent-operation";
// No environment flag, client claim or key presence can certify provider access, quality and paid tool bounds.
export function serverProAgent(): ProAgentOperation | undefined {
  return undefined;
}
export const agentPowerRouter = createAgentRouter({
  ledger: proLedger,
  executor: serverProAgent,
  documents: serverProAgentDocuments,
  selected: async (account) => {
    const [user] = await drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, account));
    return user?.config?.aiPower?.mode === "pro";
  },
  dispatch: (account, id) => start(proAgentWorkflow, [account, id]),
});

// Saved document writes use the same private registration regardless of provider activation.
export function serverProAgentDocuments() {
  return new SqlAgentDocuments(
    proLedger(),
    createAgentImageStore(generatedImages),
    (document, parent) => revalidateEntities(document, parent),
  );
}
