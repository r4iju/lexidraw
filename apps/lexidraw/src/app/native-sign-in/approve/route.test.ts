/// <reference types="bun" />
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";

import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();

/** Who `auth()` answers with; the route reads nothing else of the session. */
let session: { user: { id: string } } | null = null;
const realAuth = await import("~/server/auth");
mock.module("~/server/auth", () => ({ ...realAuth, auth: () => session }));

const { POST: approve } = await import("./route");
const rest = await import("~/app/api/v1/[...trpc]/route");
const { tokensRouter } = await import("~/server/api/routers/tokens");

const USER = "native_user";
const ORIGIN = "http://lexidraw.test";
const CALLBACK = "lexidraw://auth/callback";
// The pair was worked out with `openssl dgst -sha256 -binary | base64url`,
// independently of the server's own hashing.
const VERIFIER = "native-sign-in-test-verifier-0123456789-abcdef";
const CHALLENGE = "hUpXCXT64j8084MaqUgQg0WokXO-TzAmwaSz4tE35b4";

// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON, asserted on below
type Json = Record<string, any>;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: USER, name: "Native", email: "native@example.test" });
});

afterEach(() => {
  session = null;
  setSystemTime();
});

/** The consent form's submission, as the browser sends it. */
function submitConsent(
  fields: Record<string, string>,
  headers: Record<string, string> = { origin: ORIGIN },
) {
  return approve(
    new Request(`${ORIGIN}/native-sign-in/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields),
    }),
  );
}

const consent = {
  redirectUri: CALLBACK,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: "S256",
  deviceName: "Emanuel’s iPhone",
};

/** Signs in and approves, answering the code the callback carries. */
async function codeFor(fields: Record<string, string> = consent) {
  session = { user: { id: USER } };
  const response = await submitConsent(fields);
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location") ?? "");
  expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(
    CALLBACK,
  );
  const code = location.searchParams.get("code");
  expect(code).toBeTruthy();
  return code as string;
}

async function call(
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; token?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await rest[method](
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await response.text();
  return { response, body: (text ? JSON.parse(text) : {}) as Json };
}

function exchange(code: string, overrides: Record<string, string> = {}) {
  return call("POST", "/native-sign-in/token", {
    body: { code, codeVerifier: VERIFIER, redirectUri: CALLBACK, ...overrides },
  });
}

const settingsCaller = () =>
  tokensRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: USER }, expires: "" },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);

describe("a native app signing in", () => {
  test("gets a write token named for the device, which the API accepts", async () => {
    const code = await codeFor();

    const { response, body } = await exchange(code);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.token).toStartWith("lxd_");
    expect(body.name).toBe("Emanuel’s iPhone");
    expect(body.scope).toBe("write");

    const me = await call("GET", "/me", { token: body.token });
    expect(me.response.status).toBe(200);
    expect(me.body).toMatchObject({ userId: USER, scope: "write" });
  });

  test("lists the token in Settings, where revoking it ends the app's access", async () => {
    const { body } = await exchange(
      await codeFor({ ...consent, deviceName: "Revoked iPad" }),
    );
    const listed = (await settingsCaller().list()).find(
      (token) => token.name === "Revoked iPad",
    );
    expect(listed).toMatchObject({ scope: "write", revokedAt: null });

    await settingsCaller().revoke({ id: listed?.id ?? "" });

    const me = await call("GET", "/me", { token: body.token });
    expect(me.response.status).toBe(401);
  });

  test("names the token from a device name stripped of control characters", async () => {
    const { body } = await exchange(
      await codeFor({
        ...consent,
        deviceName: "  Work\u0000\n  iPhone\u202e ",
      }),
    );
    expect(body.name).toBe("Work iPhone");
  });
});

describe("a native app signing out", () => {
  test("revokes the token it presents, and no other", async () => {
    const leaving = await exchange(
      await codeFor({ ...consent, deviceName: "Leaving iPhone" }),
    );
    const staying = await exchange(
      await codeFor({ ...consent, deviceName: "Staying iPad" }),
    );

    const revoked = await call("POST", "/me/token/revoke", {
      body: {},
      token: leaving.body.token,
    });
    expect(revoked.response.status).toBe(200);

    expect(
      (await call("GET", "/me", { token: leaving.body.token })).response.status,
    ).toBe(401);
    expect(
      (await call("GET", "/me", { token: staying.body.token })).response.status,
    ).toBe(200);
    const listed = await settingsCaller().list();
    expect(
      listed.find((token) => token.name === "Leaving iPhone")?.revokedAt,
    ).not.toBeNull();
    expect(
      listed.find((token) => token.name === "Staying iPad")?.revokedAt,
    ).toBeNull();
  });

  test("is refused to a browser session, which has no token to revoke", async () => {
    await expect(settingsCaller().revokeCurrent({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("a code", () => {
  test("works once, and a replay ends the token it issued", async () => {
    const code = await codeFor();
    const first = await exchange(code);
    expect(first.response.status).toBe(200);

    const replay = await exchange(code);
    expect(replay.response.status).toBe(400);
    expect(replay.body.code).toBe("BAD_REQUEST");
    expect(replay.body.token).toBeUndefined();

    const me = await call("GET", "/me", { token: first.body.token });
    expect(me.response.status).toBe(401);
  });

  test("replayed without the verifier is refused and leaves the token alone", async () => {
    const code = await codeFor();
    const first = await exchange(code);
    expect(first.response.status).toBe(200);

    const withoutTheBinding: Record<string, string>[] = [
      { codeVerifier: "a-different-verifier-that-is-long-enough-1234" },
      { redirectUri: "lexidraw://other/callback" },
    ];
    for (const overrides of withoutTheBinding) {
      const replay = await exchange(code, overrides);
      expect(replay.response.status).toBe(400);
    }

    const me = await call("GET", "/me", { token: first.body.token });
    expect(me.response.status).toBe(200);
  });

  test("needs the verifier behind its challenge, and is spent by a wrong one", async () => {
    const code = await codeFor();
    const wrong = await exchange(code, {
      codeVerifier: "a-different-verifier-that-is-long-enough-1234",
    });
    expect(wrong.response.status).toBe(400);
    expect(wrong.body.token).toBeUndefined();

    const right = await exchange(code);
    expect(right.response.status).toBe(400);
  });

  test("is bound to the callback it was issued for", async () => {
    const code = await codeFor();
    const { response } = await exchange(code, {
      redirectUri: "lexidraw://other/callback",
    });
    expect(response.status).toBe(400);
  });

  test("expires a minute after it is issued", async () => {
    const issuedAt = new Date("2026-09-26T00:00:00.000Z");
    setSystemTime(issuedAt);
    const code = await codeFor();
    setSystemTime(new Date(issuedAt.getTime() + 61_000));

    const { response, body } = await exchange(code);
    expect(response.status).toBe(400);
    expect(body.token).toBeUndefined();
  });
});

describe("the consent", () => {
  test("never redirects to a callback outside the allow-list", async () => {
    session = { user: { id: USER } };
    for (const redirectUri of [
      "https://evil.example/callback",
      "lexidraw://auth/callback.evil",
      "lexidraw://auth/callback?next=https://evil.example",
    ]) {
      const response = await submitConsent({ ...consent, redirectUri });
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  test("refuses a challenge method other than S256", async () => {
    session = { user: { id: USER } };
    const response = await submitConsent({
      ...consent,
      codeChallengeMethod: "plain",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  test("is refused when another site submits it", async () => {
    session = { user: { id: USER } };
    const crossSite: Record<string, string>[] = [
      { origin: "https://evil.example" },
      {},
    ];
    for (const headers of crossSite) {
      const response = await submitConsent(consent, headers);
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  test("needs someone signed in", async () => {
    session = null;
    const response = await submitConsent(consent);
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });
});
