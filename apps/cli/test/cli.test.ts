import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli";
import type { OpenApiDocument } from "../src/openapi";
import { fakeIo, startStub, type Stub } from "./helpers";

const fixture = (await Bun.file(
  join(import.meta.dir, "fixtures", "openapi.json"),
).json()) as OpenApiDocument;

const ENTITY = {
  id: "abc",
  title: "QA doc",
  appState: null,
  elements: "{}",
  publicAccess: "PRIVATE",
  sharedWith: [],
  accessLevel: "EDIT",
};

const unauthorized = () =>
  Response.json(
    {
      message: "Invalid, expired, or revoked API token",
      code: "UNAUTHORIZED",
      issues: [],
    },
    { status: 401 },
  );

let stub: Stub;
let cacheHome: string;

beforeAll(async () => {
  cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-cli-"));
  stub = startStub((url, request) => {
    if (url.pathname === "/api/v1/openapi.json") return Response.json(fixture);
    if (request.headers.get("authorization") !== "Bearer lxd_good") {
      return unauthorized();
    }
    if (url.pathname === "/api/v1/me") {
      return Response.json({
        userId: "user-1",
        email: "qa@example.test",
        authKind: "token",
        scope: "write",
      });
    }
    if (url.pathname === "/api/v1/entities/abc") return Response.json(ENTITY);
    if (url.pathname === "/api/v1/html") {
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    }
    return Response.json({ message: "no", code: "NOT_FOUND" }, { status: 404 });
  });
});

afterAll(() => {
  stub.stop();
});

function env(extra: Record<string, string> = {}) {
  return {
    LEXIDRAW_PROFILE: "dev",
    LEXIDRAW_URL: stub.baseUrl,
    XDG_CACHE_HOME: cacheHome,
    ...extra,
  };
}

describe("api", () => {
  it("prints the response JSON on 2xx", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["api", "GET", "/entities/abc"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout())).toEqual(ENTITY);
    expect(io.stderr()).toBe("");
  });

  it("sends the keychain token when the environment has none", async () => {
    const io = fakeIo({ env: env(), tokens: { dev: "lxd_good" } });
    expect(await run(["api", "GET", "/entities/abc"], io.io)).toBe(0);
    expect(stub.requests.at(-1)?.auth).toBe("Bearer lxd_good");
  });

  it("appends --query pairs", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    await run(["api", "GET", "/entities/abc", "--query", "raw=1"], io.io);
    expect(stub.requests.at(-1)?.path).toBe("/api/v1/entities/abc?raw=1");
  });

  it("surfaces a 401 as a structured error and exit 1", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_bogus" }) });
    expect(await run(["api", "GET", "/entities/abc"], io.io)).toBe(1);
    expect(io.stdout()).toBe("");
    expect(JSON.parse(io.stderr())).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid, expired, or revoked API token",
      status: 401,
      issues: [],
    });
  });

  it("reports an unreachable server as NETWORK", async () => {
    const io = fakeIo({
      env: env({
        LEXIDRAW_TOKEN: "lxd_good",
        LEXIDRAW_URL: "http://127.0.0.1:1",
      }),
    });
    expect(await run(["api", "GET", "/entities/abc"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr()).code).toBe("NETWORK");
  });

  it("reports a non-JSON body as BAD_RESPONSE", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["api", "GET", "/html"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr()).code).toBe("BAD_RESPONSE");
  });

  it("fails with NO_TOKEN when nothing supplies one", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["api", "GET", "/entities/abc"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr()).code).toBe("NO_TOKEN");
  });

  it("rejects a method the API does not take", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["api", "TRACE", "/entities/abc"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });

  it("rejects a --json body that is not JSON", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["api", "POST", "/entities", "--json", "{"], io.io)).toBe(
      2,
    );
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });
});

describe("auth", () => {
  it("status reports the keychain as the source", async () => {
    const io = fakeIo({ env: env(), tokens: { dev: "lxd_good" } });
    expect(await run(["auth", "status"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout())).toEqual({
      profile: "dev",
      baseUrl: stub.baseUrl,
      tokenSource: "keychain",
      user: { userId: "user-1", email: "qa@example.test" },
      scope: "write",
    });
  });

  it("status reports the environment as the source", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    await run(["auth", "status"], io.io);
    expect(JSON.parse(io.stdout()).tokenSource).toBe("env");
  });

  it("status without a token exits 1 with NO_TOKEN", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "status"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr())).toMatchObject({
      code: "NO_TOKEN",
      profile: "dev",
      tokenSource: "none",
    });
  });

  it("status with a rejected token surfaces the server's 401", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_bogus" }) });
    expect(await run(["auth", "status"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr())).toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("login validates the token before it stores it", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "login", "--token", "lxd_good"], io.io)).toBe(0);
    expect(io.stored.get("dev")).toBe("lxd_good");
    expect(JSON.parse(io.stdout())).toEqual({
      profile: "dev",
      userId: "user-1",
      email: "qa@example.test",
      scope: "write",
    });
  });

  it("login stores nothing when the server rejects the token", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "login", "--token", "lxd_bogus"], io.io)).toBe(1);
    expect(io.stored.has("dev")).toBe(false);
  });

  it("login reads the token from stdin when no flag is given", async () => {
    const io = fakeIo({ env: env(), stdin: "lxd_good\n" });
    expect(await run(["auth", "login"], io.io)).toBe(0);
    expect(io.stored.get("dev")).toBe("lxd_good");
  });

  it("login rejects something that is not a Lexidraw token", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "login", "--token", "nope"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });
});

describe("schema", () => {
  it("prints the operation behind a command", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "doc get"], io.io)).toBe(0);
    const schema = JSON.parse(io.stdout());
    expect(schema).toMatchObject({
      command: "doc get",
      method: "GET",
      path: "/entities/{id}",
      operationId: "entities-load",
    });
    expect(schema.parameters.map((p: { name: string }) => p.name)).toEqual([
      "id",
    ]);
  });

  it("accepts the command as separate words", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "doc", "get"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout()).command).toBe("doc get");
  });

  it("lists the known commands", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "--list"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout()).commands).toContainEqual({
      command: "auth status",
      operationId: "auth-me",
    });
  });

  it("fails an unknown command with exit 2 and the known names", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "doc frobnicate"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr())).toMatchObject({
      code: "UNKNOWN_COMMAND",
      known: ["auth status", "doc get"],
    });
  });
});

describe("dispatch", () => {
  it("prints usage for --help", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["--help"], io.io)).toBe(0);
    expect(io.stdout()).toContain("lexidraw auth login");
  });

  it("fails an unknown top-level command with exit 2", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["frobnicate"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr())).toMatchObject({
      code: "USAGE",
      known: ["api", "auth", "schema"],
    });
  });

  it("fails an unknown profile with exit 2", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "status", "--profile", "staging"], io.io)).toBe(
      2,
    );
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });
});
