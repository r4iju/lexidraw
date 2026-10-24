import "server-only";
import { createClient } from "@libsql/client";
import env from "@packages/env";
import { z } from "zod";
import { ProLedger } from "./ledger";
import { sandboxConfig } from "./billing-config";
import { appleSandboxConfig } from "./apple-runtime-config";
import { NARRATION_BOOK } from "~/lib/narration/contracts";
let instance: ProLedger | undefined;
export function proLedger() {
  if (!instance) {
    const owners = z.array(z.string().min(1).max(100)).parse(
      (process.env.PRO_OWNER_ACCOUNT_IDS ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    instance = new ProLedger(
      createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
      {
        ownerAccountIds: owners,
        now: Date.now,
        sandboxBillingAvailable: sandboxConfig(process.env) !== null,
        appleSandboxAvailable: appleSandboxConfig(process.env) !== null,
        // Preflighted 2026-10-24: Gemini honours maxOutputTokens for this book (docs/private-pro-narration.md).
        supplierBooks: () => ({
          verification: "verified-server",
          narration: NARRATION_BOOK,
        }),
      },
    );
  }
  return instance;
}
