import "server-only";

import env from "@packages/env";

export async function createPrintTokenStep(
  userId: string,
  entityId: string,
  ttlMs: number,
): Promise<string> {
  "use step";

  const crypto = await import("node:crypto");

  const header = { alg: "HS256", typ: "JWT" } as const;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor(ttlMs / 1000);
  const payload = {
    userId,
    entityId,
    scope: "print-document",
    iat: nowSec,
    exp: expSec,
  };

  function base64url(input: Buffer | string): string {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
    return b
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", env.SHARED_KEY).update(data).digest();
  const encSig = base64url(sig);
  return `${data}.${encSig}`;
}
