/// <reference types="bun" />
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq } from "drizzle-orm";
import { JSDOM } from "jsdom";
import { NextRequest } from "next/server";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { createAuth } = await import("./create-auth");
const { hashPassword } = await import("./password");

const APPLE = "https://appleid.apple.com";
const GITHUB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const SERVICES_ID = "test.lexidraw.signin";
const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY1234567";
const PASSWORD = "Correct-Horse-Battery-9!";

const appleKey = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const pkcs8 = Buffer.from(
  await crypto.subtle.exportKey("pkcs8", appleKey.privateKey),
).toString("base64");

const { handlers } = createAuth({
  db,
  github: { clientId: "github-client", clientSecret: "github-secret" },
  apple: {
    servicesId: SERVICES_ID,
    teamId: TEAM_ID,
    keyId: KEY_ID,
    // As it sits in an env file: one line, newlines escaped.
    privateKey: `-----BEGIN PRIVATE KEY-----\\n${pkcs8}\\n-----END PRIVATE KEY-----`,
  },
});

/** What Apple's ID token says about the person signing in. */
type AppleClaims = {
  sub: string;
  email: string;
  email_verified: boolean | "true" | "false";
  is_private_email?: boolean | "true";
};

/** The token requests Apple was sent, as their form bodies. */
let tokenRequests: URLSearchParams[] = [];
let claims: AppleClaims;
let nonce: string | null = null;
/** Who GitHub says is signing in. */
let githubUser: { id: number; login: string; email: string };

function b64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

/** Apple and GitHub, answering from `claims` and `githubUser`. */
function fakeProviders() {
  const real = globalThis.fetch;
  spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === `${GITHUB}/login/oauth/access_token`) {
      return Response.json({ access_token: "gh-access", token_type: "bearer" });
    }
    if (url.href === `${GITHUB_API}/user`) {
      return Response.json({ ...githubUser, name: githubUser.login });
    }
    if (url.origin !== APPLE) return real(input, init);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: APPLE,
        authorization_endpoint: `${APPLE}/auth/authorize`,
        token_endpoint: `${APPLE}/auth/token`,
        jwks_uri: `${APPLE}/auth/keys`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url.pathname === "/auth/token") {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        b64url(JSON.stringify({ alg: "RS256", kid: "apple" })),
        b64url(
          JSON.stringify({
            iss: APPLE,
            aud: SERVICES_ID,
            iat: now,
            exp: now + 600,
            nonce,
            ...claims,
          }),
        ),
        b64url("signature"),
      ].join(".");
      return Response.json({
        access_token: "apple-access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch);
}

/** A browser's cookies for this site, as the handlers set them. */
class Browser {
  cookies = new Map<string, string>();

  async send(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, string>,
    headers: Record<string, string> = {},
  ) {
    const crossSite = headers["sec-fetch-site"] === "cross-site";
    const response = await (method === "GET" ? handlers.GET : handlers.POST)(
      new NextRequest(new URL(path, "http://localhost:3025"), {
        method,
        headers: {
          // Every cookie of the site is SameSite=Lax, which a browser keeps
          // off a POST from another site.
          ...(!crossSite && {
            cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          }),
          "sec-fetch-site": "same-origin",
          ...(body && {
            "content-type": "application/x-www-form-urlencoded",
          }),
          ...headers,
        },
        body: body && new URLSearchParams(body).toString(),
      }),
    );
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  async csrfToken() {
    const response = await this.send("GET", "/api/auth/csrf");
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }

  /** Signs in with a password, as the sign-in form does. */
  async signInWithPassword(email: string) {
    const csrfToken = await this.csrfToken();
    await this.send("POST", "/api/auth/callback/credentials", {
      csrfToken,
      email,
      password: PASSWORD,
    });
  }

  /**
   * Continues with Apple and comes back with `as`; `user` is the name Apple
   * posts back only the first time someone consents. Where the browser ends
   * up.
   */
  async signInWithApple(
    as: AppleClaims,
    user?: object,
    callbackUrl = "/dashboard",
  ) {
    const csrfToken = await this.csrfToken();
    const start = await this.send("POST", "/api/auth/signin/apple", {
      csrfToken,
      callbackUrl,
    });
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin).toBe(APPLE);
    nonce = authorize.searchParams.get("nonce");
    claims = as;
    const done = await this.fromApple({
      code: "apple-code",
      state: authorize.searchParams.get("state") ?? "",
      ...(user && { user: JSON.stringify(user) }),
    });
    return new URL(done.headers.get("location") ?? "", "http://localhost");
  }

  /**
   * Apple's form post back to the callback, which comes from Apple's site,
   * then whatever the page it gets back posts on from this one.
   */
  async fromApple(fields: Record<string, string>) {
    const posted = await this.send("POST", "/api/auth/callback/apple", fields, {
      "sec-fetch-site": "cross-site",
    });
    expect(posted.headers.get("content-type")).toStartWith("text/html");
    const { document } = new JSDOM(await posted.text()).window;
    const form = document.forms[0];
    if (!form) throw new Error("the callback page has no form");
    expect(form.method).toBe("post");
    expect(form.getAttribute("action") ?? "").toBe("");
    const reposted = Object.fromEntries(
      [...form.querySelectorAll("input")].map((i) => [i.name, i.value]),
    );
    expect(reposted).toEqual(fields);
    return this.send("POST", "/api/auth/callback/apple", reposted);
  }

  async signInWithGitHub(as: typeof githubUser) {
    const csrfToken = await this.csrfToken();
    const start = await this.send("POST", "/api/auth/signin/github", {
      csrfToken,
      callbackUrl: "/dashboard",
    });
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin).toBe(GITHUB);
    githubUser = as;
    const back = new URLSearchParams({ code: "gh-code" });
    const state = authorize.searchParams.get("state");
    if (state) back.set("state", state);
    const done = await this.send("GET", `/api/auth/callback/github?${back}`);
    return new URL(done.headers.get("location") ?? "", "http://localhost");
  }
}

async function userByEmail(email: string) {
  return db.query.users.findFirst({ where: eq(schema.users.email, email) });
}

/** The account a provider account signs in to, if it is linked. */
async function appleAccountOf(sub: string) {
  return db.query.accounts.findFirst({
    where: eq(schema.accounts.providerAccountId, sub),
  });
}

async function seedUser(id: string, email: string, verified: boolean) {
  await db.insert(schema.users).values({
    id,
    name: id,
    email,
    password: await hashPassword(PASSWORD),
    emailVerified: verified ? Date.now() : null,
  });
}

beforeEach(() => {
  fakeProviders();
  // Auth.js logs every refused sign-in as an error.
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  tokenRequests = [];
});

describe("Sign in with Apple", () => {
  test("a first sign-in with an unused email creates a verified account named as Apple says", async () => {
    const browser = new Browser();

    const landed = await browser.signInWithApple(
      { sub: "apple.fresh", email: "fresh@example.test", email_verified: true },
      { name: { firstName: "Ada", lastName: "Lovelace" } },
    );

    expect(landed.searchParams.get("error")).toBeNull();
    const user = await userByEmail("fresh@example.test");
    expect(user?.name).toBe("Ada Lovelace");
    expect(user?.emailVerified).not.toBeNull();
    expect((await appleAccountOf("apple.fresh"))?.userId).toBe(user?.id);
  });

  test("a later sign-in, which Apple sends without a name, keeps the stored one", async () => {
    const as = {
      sub: "apple.again",
      email: "again@example.test",
      email_verified: "true",
    } as const;
    await new Browser().signInWithApple(as, {
      name: { firstName: "Grace", lastName: "Hopper" },
    });
    await db
      .update(schema.users)
      .set({ name: "Grace B. Hopper" })
      .where(eq(schema.users.email, as.email));

    const browser = new Browser();
    const landed = await browser.signInWithApple(as);

    expect(landed.searchParams.get("error")).toBeNull();
    expect((await userByEmail(as.email))?.name).toBe("Grace B. Hopper");
    const session = await browser.send("GET", "/api/auth/session");
    expect(await session.json()).toMatchObject({
      user: { name: "Grace B. Hopper", email: as.email },
    });
  });

  describe("when the email already has an account", () => {
    test("links to it when Apple and the account have both proven the email", async () => {
      await seedUser("link_verified", "verified@example.test", true);

      const landed = await new Browser().signInWithApple({
        sub: "apple.verified",
        email: "verified@example.test",
        email_verified: true,
      });

      expect(landed.searchParams.get("error")).toBeNull();
      expect((await appleAccountOf("apple.verified"))?.userId).toBe(
        "link_verified",
      );
    });

    test("refuses when the account never proved the email, and links nothing", async () => {
      await seedUser("link_unverified", "unverified@example.test", false);

      const landed = await new Browser().signInWithApple({
        sub: "apple.unverified",
        email: "unverified@example.test",
        email_verified: true,
      });

      expect(landed.pathname).toBe("/signin");
      expect(landed.searchParams.get("error")).toBe("OAuthAccountNotLinked");
      expect(await appleAccountOf("apple.unverified")).toBeUndefined();
    });

    test("refuses when Apple did not verify the email", async () => {
      await seedUser("link_apple_unverified", "apple-unv@example.test", true);

      const landed = await new Browser().signInWithApple({
        sub: "apple.apple_unverified",
        email: "apple-unv@example.test",
        email_verified: "false",
      });

      expect(landed.searchParams.get("error")).toBe("OAuthAccountNotLinked");
      expect(await appleAccountOf("apple.apple_unverified")).toBeUndefined();
    });

    test("links to whoever is signed in, proven or not", async () => {
      await seedUser("link_signed_in", "signed-in@example.test", false);
      const browser = new Browser();
      await browser.signInWithPassword("signed-in@example.test");

      const landed = await browser.signInWithApple({
        sub: "apple.signed_in",
        email: "signed-in@example.test",
        email_verified: true,
      });

      expect(landed.searchParams.get("error")).toBeNull();
      expect((await appleAccountOf("apple.signed_in"))?.userId).toBe(
        "link_signed_in",
      );
    });

    test("GitHub, which proves no email, never links by one", async () => {
      await seedUser("link_github", "github@example.test", true);

      const landed = await new Browser().signInWithGitHub({
        id: 4242,
        login: "octo",
        email: "github@example.test",
      });

      expect(landed.searchParams.get("error")).toBe("OAuthAccountNotLinked");
      expect(await appleAccountOf("4242")).toBeUndefined();
    });
  });

  test("a hidden relay address becomes the account email", async () => {
    const relay = "x7k2p9q4mz@privaterelay.appleid.com";

    await new Browser().signInWithApple({
      sub: "apple.relay",
      email: relay,
      email_verified: "true",
      is_private_email: "true",
    });

    const user = await userByEmail(relay);
    expect((await appleAccountOf("apple.relay"))?.userId).toBe(user?.id);
    expect(user?.emailVerified).not.toBeNull();
  });

  test("Apple is sent a client secret signed with the Apple key for this Services ID", async () => {
    await new Browser().signInWithApple({
      sub: "apple.secret",
      email: "secret@example.test",
      email_verified: true,
    });

    const [request] = tokenRequests;
    expect(request?.get("client_id")).toBe(SERVICES_ID);
    const [header = "", payload = "", signature = ""] = (
      request?.get("client_secret") ?? ""
    ).split(".");
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      appleKey.publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: KEY_ID,
    });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({
      iss: TEAM_ID,
      sub: SERVICES_ID,
      aud: "https://appleid.apple.com",
    });
    const now = Date.now() / 1000;
    expect(claims.iat).toBeLessThanOrEqual(now);
    expect(claims.exp).toBeGreaterThan(now);
  });

  test("Apple's post comes back from this site with its fields as sent, markup and all", async () => {
    await new Browser().fromApple({
      state: '"><script>alert(1)</script>',
      user: '{"name":{"firstName":"<b>Ada</b> & co"}}',
    });
  });

  test("Apple's post comes back from this site even from a browser that does not say where a request came from", async () => {
    const posted = await handlers.POST(
      new NextRequest(
        new URL("/api/auth/callback/apple", "http://localhost:3025"),
        {
          method: "POST",
          headers: {
            origin: APPLE,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "state=s&code=c",
        },
      ),
    );

    expect(posted.headers.get("content-type")).toStartWith("text/html");
  });

  test("only Apple's callback is posted back, not another provider's", async () => {
    const posted = await new Browser().send(
      "POST",
      "/api/auth/callback/github",
      { code: "gh-code" },
      { "sec-fetch-site": "cross-site" },
    );

    expect(posted.headers.get("content-type") ?? "").not.toStartWith(
      "text/html",
    );
  });

  test("a sign-in that began on its way somewhere comes back there, new account or not", async () => {
    const as = {
      sub: "apple.callback",
      email: "callback@example.test",
      email_verified: true,
    } as const;
    const back = "/documents/doc_callback?view=read";

    const first = await new Browser().signInWithApple(as, undefined, back);
    const again = await new Browser().signInWithApple(as, undefined, back);

    expect(`${first.pathname}${first.search}`).toBe(back);
    expect(`${again.pathname}${again.search}`).toBe(back);
  });
});
