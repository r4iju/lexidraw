import "server-only";
import { SandboxBilling } from "./billing";
import { sandboxConfig } from "./billing-config";
import { proLedger } from "./runtime";
import { ProError } from "./ledger";
export function sandboxBilling() {
  const config = sandboxConfig(process.env);
  if (!config) throw new ProError("Sandbox billing unavailable");
  return new SandboxBilling(proLedger(), config);
}
