import { proChat, PRO_CHAT_AVAILABLE } from "./chat-runtime";
import { start } from "workflow/api";
import { createProRouter } from "~/server/api/routers/pro";
import { proTextWorkflow } from "~/workflows/pro-text/workflow";
import { proLedger } from "./runtime";
import { sandboxBilling } from "./billing-runtime";
import { appleSandboxBilling } from "./apple-runtime";
import { SqlAgentDocuments } from "./agent-documents";
export const proRouter = createProRouter({
  ledger: proLedger,
  documents: () => new SqlAgentDocuments(proLedger()),
  textAvailable: false,
  chat: PRO_CHAT_AVAILABLE ? proChat : undefined,
  billing: sandboxBilling,
  appleBilling: appleSandboxBilling,
  dispatch: async (id, text, account) => {
    await start(proTextWorkflow, [account, id, text]);
  },
});
