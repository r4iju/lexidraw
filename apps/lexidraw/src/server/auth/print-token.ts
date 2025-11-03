import env from "@packages/env";
import crypto from "node:crypto";

type BasePayload = {
  userId: string;
  entityId: string;
  scope: "print-document";
  iat: number; // seconds
  exp: number; // seconds
};

function base64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function createPrintToken(params: {
  userId: string;
  entityId: string;
  ttlMs?: number;
}): string {
  const header = { alg: "HS256", typ: "JWT" } as const;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor((params.ttlMs ?? 5 * 60_000) / 1000); // 5 min default
  const payload: BasePayload = {
    userId: params.userId,
    entityId: params.entityId,
    scope: "print-document",
    iat: nowSec,
    exp: expSec,
  };

  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;

  const sig = crypto.createHmac("sha256", env.SHARED_KEY).update(data).digest();
  const encSig = base64url(sig);
  return `${data}.${encSig}`;
}

export function verifyPrintToken(token: string): BasePayload | null {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const data = `${h}.${p}`;
    const expected = base64url(
      crypto.createHmac("sha256", env.SHARED_KEY).update(data).digest(),
    );
    if (expected !== s) return null;
    const json = JSON.parse(
      Buffer.from(p, "base64").toString("utf8"),
    ) as BasePayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof json.exp !== "number" || json.exp < nowSec) return null;
    if (json.scope !== "print-document") return null;
    return json;
  } catch {
    return null;
  }
}
