import "server-only";
import { createClient } from "@libsql/client";
import env from "@packages/env";
import { z } from "zod";
import { ProLedger } from "./ledger";
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
      { ownerAccountIds: owners, now: Date.now },
    );
  }
  return instance;
}
