import { start } from "workflow/api";
import { createProRouter } from "~/server/api/routers/pro";
import { proTextWorkflow } from "~/workflows/pro-text/workflow";
import { proLedger } from "./runtime";
import { sandboxBilling } from "./billing-runtime";
import { appleSandboxBilling } from "./apple-runtime";
export const proRouter = createProRouter({
  ledger: proLedger,
  billing: sandboxBilling,
  appleBilling: appleSandboxBilling,
  dispatch: async (id, text, account) => {
    await start(proTextWorkflow, [account, id, text]);
  },
});
