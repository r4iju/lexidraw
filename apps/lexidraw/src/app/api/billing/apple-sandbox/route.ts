import { appleSandboxBilling } from "~/server/pro/apple-runtime";
import { appleSandboxWebhook } from "~/server/pro/apple-webhook";
export const POST = appleSandboxWebhook(appleSandboxBilling);
