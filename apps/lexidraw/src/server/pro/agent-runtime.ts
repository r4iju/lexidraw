import "server-only";
import { start } from "workflow/api";
import { drizzle, schema, eq } from "@packages/drizzle";
import { createAgentRouter } from "~/server/api/routers/pro-agent";
import { proAgentWorkflow } from "~/workflows/pro-agent/workflow";
import { proLedger } from "./runtime";
import type { ProAgentOperation } from "./agent-operation";
// No environment flag, client claim or key presence can certify provider access, quality and paid tool bounds.
export function serverProAgent(): ProAgentOperation | undefined {
  return undefined;
}
export const agentPowerRouter = createAgentRouter({
  ledger: proLedger,
  executor: serverProAgent,
  selected: async (account) => {
    const [user] = await drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, account));
    return user?.config?.aiPower?.mode === "pro";
  },
  dispatch: (account, id) => start(proAgentWorkflow, [account, id]),
});
