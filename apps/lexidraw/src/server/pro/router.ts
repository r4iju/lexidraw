import { start } from "workflow/api";
import { createProRouter } from "~/server/api/routers/pro";
import { proTextWorkflow } from "~/workflows/pro-text/workflow";
import { proLedger } from "./runtime";
import { sandboxBilling } from "./billing-runtime";
export const proRouter = createProRouter({
  ledger: proLedger,
  billing: sandboxBilling,
  dispatch: async (id, text, account) => {
    await start(proTextWorkflow, [account, id, text]);
  },
});
