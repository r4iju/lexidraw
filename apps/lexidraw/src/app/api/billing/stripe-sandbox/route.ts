import { sandboxBilling } from "~/server/pro/billing-runtime";
import { sandboxWebhook } from "~/server/pro/billing-webhook";
export const POST = sandboxWebhook(sandboxBilling);
