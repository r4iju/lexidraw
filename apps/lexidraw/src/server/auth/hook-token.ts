import env from "@packages/env";
import crypto from "node:crypto";

export type HookTokenPayload = {
  runId: string;
  toolCallId: string;
  userId: string;
  documentId: string;
  scope: "tool-callback";
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

export function createHookToken(params: {
  runId: string;
  toolCallId: string;
  userId: string;
  documentId: string;
  ttlMs?: number;
}): string {
  const header = { alg: "HS256", typ: "JWT" } as const;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor((params.ttlMs ?? 60_000) / 1000); // 1 min default
  const payload: HookTokenPayload = {
    runId: params.runId,
    toolCallId: params.toolCallId,
    userId: params.userId,
    documentId: params.documentId,
    scope: "tool-callback",
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

export function verifyHookToken(token: string): HookTokenPayload | null {
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
    ) as HookTokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof json.exp !== "number" || json.exp < nowSec) return null;
    if (json.scope !== "tool-callback") return null;
    return json;
  } catch {
    return null;
  }
}
