import { start } from "workflow/api";
import { createProRouter } from "~/server/api/routers/pro";
import { proTextWorkflow } from "~/workflows/pro-text/workflow";
import { proLedger } from "./runtime";
export const proRouter = createProRouter({
  ledger: proLedger,
  dispatch: async (id, text, account) => {
    await start(proTextWorkflow, [account, id, text]);
  },
});
