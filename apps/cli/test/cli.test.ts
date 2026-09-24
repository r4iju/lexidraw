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

const DRAWING = {
  id: "abc",
  title: "QA drawing",
  elements: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 1, height: 1 }],
  appState: {},
  updatedAt: "2026-09-23T10:00:00.000Z",
};

/** Labelled in non-ASCII, so a byte count and a character count differ. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><text>Ingest \u2192 Résumé</text></svg>';

/** A one pixel PNG, so the bytes the CLI writes are recognisably an image. */
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
]);

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
    if (url.pathname === "/api/v1/drawings/abc") {
      return request.method === "PUT"
        ? Response.json({
            id: "abc",
            updatedAt: "2026-09-23T10:00:01.000Z",
            elementCount: 1,
          })
        : Response.json(DRAWING);
    }
    if (url.pathname === "/api/v1/drawings/stale") {
      return request.method === "PUT"
        ? Response.json(
            {
              message:
                "Drawing was modified at 2026-09-23T10:00:05.000Z; re-read it and retry with the new updatedAt",
              code: "CONFLICT",
            },
            { status: 409 },
          )
        : Response.json({ ...DRAWING, id: "stale" });
    }
    if (url.pathname === "/api/v1/drawings/abc/render") {
      const format = url.searchParams.get("format") ?? "svg";
      return Response.json(
        format === "png"
          ? {
              id: "abc",
              format: "png",
              contentType: "image/png",
              encoding: "base64",
              width: 220,
              height: 100,
              data: Buffer.from(PNG).toString("base64"),
              updatedAt: DRAWING.updatedAt,
            }
          : {
              id: "abc",
              format: "svg",
              contentType: "image/svg+xml",
              encoding: "utf-8",
              width: 220,
              height: 100,
              data: SVG,
              updatedAt: DRAWING.updatedAt,
            },
      );
    }
    if (url.pathname === "/api/v1/drawings" && request.method === "POST") {
      return Response.json({
        id: "new-1",
        updatedAt: "2026-09-23T10:00:00.000Z",
        elementCount: 3,
      });
    }
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

  it("rejects a body on GET and HEAD before any request", async () => {
    for (const verb of ["GET", "HEAD"]) {
      const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
      const before = stub.requests.length;
      expect(
        await run(["api", verb, "/entities/abc", "--json", "{}"], io.io),
      ).toBe(2);
      expect(JSON.parse(io.stderr()).message).toContain("does not take a body");
      expect(stub.requests).toHaveLength(before);
    }
  });

  it("rejects a path that climbs out of /api/v1", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    const before = stub.requests.length;
    expect(await run(["api", "GET", "/../../admin"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
    expect(stub.requests).toHaveLength(before);
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

  it("login turns the terminal echo off around a prompted paste", async () => {
    const io = fakeIo({ env: env(), stdin: "lxd_good\n", tty: true });
    expect(await run(["auth", "login"], io.io)).toBe(0);
    expect(io.echo).toEqual([false, true]);
    expect(io.stderr()).toContain("Paste a token");
  });

  it("login rejects something that is not a Lexidraw token", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "login", "--token", "nope"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });

  it("login rejects a token whose shape could confuse `security -i`", async () => {
    const io = fakeIo({ env: env() });
    expect(
      await run(["auth", "login", "--token", 'lxd_a" -a other -w x'], io.io),
    ).toBe(2);
    expect(io.stored.has("dev")).toBe(false);
  });
});

describe("origin rule", () => {
  it("refuses to read the keychain for a profile pointed elsewhere", async () => {
    const io = fakeIo({
      env: {
        LEXIDRAW_PROFILE: "prod",
        LEXIDRAW_URL: stub.baseUrl,
        XDG_CACHE_HOME: cacheHome,
      },
      tokens: { prod: "lxd_good" },
    });
    expect(await run(["auth", "status"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr())).toMatchObject({
      code: "NO_TOKEN",
      profile: "prod",
      tokenSource: "none",
    });
    expect(io.lookups).toEqual([]);
  });

  it("still honours LEXIDRAW_TOKEN for such an origin", async () => {
    const io = fakeIo({
      env: {
        LEXIDRAW_PROFILE: "prod",
        LEXIDRAW_URL: stub.baseUrl,
        XDG_CACHE_HOME: cacheHome,
        LEXIDRAW_TOKEN: "lxd_good",
      },
    });
    expect(await run(["auth", "status"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout()).tokenSource).toBe("env");
  });

  it("refuses to store a token for such an origin", async () => {
    const io = fakeIo({
      env: {
        LEXIDRAW_PROFILE: "prod",
        LEXIDRAW_URL: stub.baseUrl,
        XDG_CACHE_HOME: cacheHome,
      },
    });
    expect(await run(["auth", "login", "--token", "lxd_good"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
    expect(io.stored.size).toBe(0);
  });

  it("caches the schema under the origin, not the profile alone", async () => {
    const io = fakeIo({
      env: {
        LEXIDRAW_PROFILE: "prod",
        LEXIDRAW_URL: stub.baseUrl,
        XDG_CACHE_HOME: cacheHome,
      },
    });
    expect(await run(["schema", "doc get"], io.io)).toBe(0);
    const plain = join(cacheHome, "lexidraw", "prod", "openapi.json");
    expect(await Bun.file(plain).exists()).toBe(false);
    const keyed = join(
      cacheHome,
      "lexidraw",
      "prod",
      `http-${new URL(stub.baseUrl).host.replace(":", "-")}`,
      "openapi.json",
    );
    expect(await Bun.file(keyed).exists()).toBe(true);
  });
});

describe("server identity", () => {
  const impostors: Record<string, Stub> = {};

  beforeAll(() => {
    // An unrelated site answers every path with its own HTML page.
    impostors.html = startStub(
      () =>
        new Response("<!DOCTYPE html><html></html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    impostors["another API"] = startStub((url) =>
      url.pathname === "/api/v1/openapi.json"
        ? Response.json({ ...fixture, info: { title: "Some API" } })
        : Response.json({ userId: "someone-else" }),
    );
  });

  afterAll(() => {
    for (const impostor of Object.values(impostors)) impostor.stop();
  });

  const COMMANDS = [
    ["auth", "status"],
    ["api", "GET", "/me"],
    ["doc", "list"],
    ["dir", "list"],
    ["search", "plan"],
    ["drawing", "get", "abc"],
  ];

  for (const kind of ["html", "another API"]) {
    for (const argv of COMMANDS) {
      it(`${argv.join(" ")} sends no token to ${kind}`, async () => {
        const impostor = impostors[kind] as Stub;
        const io = fakeIo({
          env: {
            LEXIDRAW_PROFILE: "dev",
            LEXIDRAW_URL: impostor.baseUrl,
            LEXIDRAW_TOKEN: "lxd_good",
            XDG_CACHE_HOME: await mkdtemp(join(tmpdir(), "lexidraw-cli-")),
          },
        });
        expect(await run(argv, io.io)).toBe(1);
        expect(JSON.parse(io.stderr()).code).toBe("NOT_LEXIDRAW_SERVER");
        expect(impostor.requests.every(({ auth }) => auth === null)).toBe(true);
      });
    }

    it(`auth login stores nothing and sends nothing to ${kind}`, async () => {
      const impostor = impostors[kind] as Stub;
      const io = fakeIo({
        env: {
          LEXIDRAW_PROFILE: "dev",
          LEXIDRAW_URL: impostor.baseUrl,
          XDG_CACHE_HOME: await mkdtemp(join(tmpdir(), "lexidraw-cli-")),
        },
      });
      expect(await run(["auth", "login", "--token", "lxd_good"], io.io)).toBe(
        1,
      );
      expect(JSON.parse(io.stderr()).code).toBe("NOT_LEXIDRAW_SERVER");
      expect(io.stored.size).toBe(0);
      expect(impostor.requests.every(({ auth }) => auth === null)).toBe(true);
    });
  }
});

describe("schema", () => {
  it("prints the operation behind a command", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "doc get"], io.io)).toBe(0);
    const schema = JSON.parse(io.stdout());
    expect(schema).toMatchObject({
      command: "doc get",
      method: "GET",
      path: "/documents/{id}/markdown",
      operationId: "documents-getMarkdown",
      summary: "Read a document as markdown",
    });
    expect(schema.parameters.map((p: { name: string }) => p.name)).toEqual([
      "id",
      "format",
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
      known: expect.arrayContaining([
        "auth status",
        "doc append",
        "drawing put",
        "drawing render",
        "search",
      ]),
    });
  });

  it("treats an inherited property as an unknown command, without a request", async () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      const io = fakeIo({ env: env() });
      const before = stub.requests.length;
      expect(await run(["schema", name], io.io)).toBe(2);
      expect(JSON.parse(io.stderr()).code).toBe("UNKNOWN_COMMAND");
      expect(stub.requests).toHaveLength(before);
    }
  });
});

describe("drawing", () => {
  const body = () => JSON.parse(stub.requests.at(-1)?.body as string);

  it("get prints the parsed drawing", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "get", "abc"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout())).toEqual(DRAWING);
  });

  const put = (id: string, file: string, since = "latest") => [
    "drawing",
    "put",
    id,
    "--file",
    file,
    "--if-unmodified-since",
    since,
  ];

  it("put sends the file's elements and the id from the path", async () => {
    const file = join(cacheHome, "elements.json");
    await Bun.write(file, JSON.stringify([{ type: "rectangle", x: 0, y: 0 }]));
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(put("abc", file), io.io)).toBe(0);
    expect(stub.requests.at(-1)).toMatchObject({
      method: "PUT",
      path: "/api/v1/drawings/abc",
    });
    expect(body()).toEqual({
      id: "abc",
      elements: [{ type: "rectangle", x: 0, y: 0 }],
      // --if-unmodified-since latest reads the revision first.
      ifUnmodifiedSince: DRAWING.updatedAt,
    });
    expect(stub.requests.at(-2)).toMatchObject({
      method: "GET",
      path: "/api/v1/drawings/abc",
    });
    expect(JSON.parse(io.stdout()).elementCount).toBe(1);
  });

  it("put passes an explicit --if-unmodified-since through", async () => {
    const file = join(cacheHome, "precondition.json");
    await Bun.write(file, "[]");
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    await run(put("abc", file, "2026-09-23T10:00:00.000Z"), io.io);
    expect(body().ifUnmodifiedSince).toBe("2026-09-23T10:00:00.000Z");
    expect(stub.requests.at(-2)?.method).not.toBe("GET");
  });

  it("put reads the elements from stdin for --file -", async () => {
    const io = fakeIo({
      env: env({ LEXIDRAW_TOKEN: "lxd_good" }),
      stdin: '[{"type":"ellipse","x":1,"y":2}]',
    });
    expect(await run(put("abc", "-"), io.io)).toBe(0);
    expect(body().elements).toEqual([{ type: "ellipse", x: 1, y: 2 }]);
  });

  it("put re-raises the server's conflict", async () => {
    const file = join(cacheHome, "stale.json");
    await Bun.write(file, "[]");
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(
      await run(put("stale", file, "2026-09-23T09:00:00.000Z"), io.io),
    ).toBe(1);
    const error = JSON.parse(io.stderr());
    expect(error.code).toBe("CONFLICT");
    expect(error.status).toBe(409);
    expect(error.message).toContain("re-read it and retry");
  });

  it("put refuses a file that is not there, without a request", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    const before = stub.requests.length;
    expect(await run(put("abc", join(cacheHome, "nothing.json")), io.io)).toBe(
      2,
    );
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
    expect(stub.requests).toHaveLength(before);
  });

  it("put without --if-unmodified-since is a usage error", async () => {
    const file = join(cacheHome, "no-precondition.json");
    await Bun.write(file, "[]");
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "put", "abc", "--file", file], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("--if-unmodified-since");
  });

  it("put refuses a file that is not a JSON array, without a request", async () => {
    const file = join(cacheHome, "object.json");
    await Bun.write(file, '{"type":"rectangle"}');
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    const before = stub.requests.length;
    expect(await run(put("abc", file), io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
    expect(stub.requests).toHaveLength(before);
  });

  it("put without --file is a usage error", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "put", "abc"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("--file");
  });

  it("create posts the title and optional parent", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(
      await run(
        ["drawing", "create", "--title", "Flow", "--parent", "dir-1"],
        io.io,
      ),
    ).toBe(0);
    expect(stub.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/v1/drawings",
    });
    expect(body()).toEqual({ title: "Flow", parentId: "dir-1" });
    const created = JSON.parse(io.stdout());
    expect(created.id).toBe("new-1");
    // What the converter stored, which a shorthand payload does not predict.
    expect(created.elementCount).toBe(3);
  });

  it("create without --title is a usage error", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "create"], io.io)).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("--title");
  });

  it("surfaces the server's error code for a drawing that is not there", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "get", "missing"], io.io)).toBe(1);
    expect(JSON.parse(io.stderr()).code).toBe("NOT_FOUND");
  });

  it("render prints the SVG itself on stdout", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "render", "abc"], io.io)).toBe(0);
    expect(stub.requests.at(-1)?.path).toBe(
      "/api/v1/drawings/abc/render?format=svg",
    );
    expect(io.stdout()).toBe(SVG);
  });

  it("render decodes the base64 PNG to bytes", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(
      await run(["drawing", "render", "abc", "--format", "png"], io.io),
    ).toBe(0);
    expect(io.stdoutBytes()).toEqual(PNG);
    expect(io.stdout()).toBe("");
  });

  it("render writes --out and reports what it wrote", async () => {
    const out = join(cacheHome, "drawing.png");
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(
      await run(
        [
          "drawing",
          "render",
          "abc",
          "--format",
          "png",
          "--scale",
          "2",
          "--out",
          out,
        ],
        io.io,
      ),
    ).toBe(0);
    expect(stub.requests.at(-1)?.path).toBe(
      "/api/v1/drawings/abc/render?format=png&scale=2",
    );
    expect(await Bun.file(out).bytes()).toEqual(PNG);
    expect(JSON.parse(io.stdout())).toMatchObject({
      format: "png",
      contentType: "image/png",
      bytes: PNG.length,
      out,
    });
  });

  it("render --out reports the bytes it wrote, not the characters", async () => {
    const out = join(cacheHome, "drawing.svg");
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    expect(await run(["drawing", "render", "abc", "--out", out], io.io)).toBe(
      0,
    );
    expect(await Bun.file(out).text()).toBe(SVG);
    expect(JSON.parse(io.stdout())).toMatchObject({
      format: "svg",
      bytes: Buffer.byteLength(SVG),
      out,
    });
    // The file is longer than the string: the labels are not ASCII.
    expect(Buffer.byteLength(SVG)).toBeGreaterThan(SVG.length);
  });

  it("render refuses to write PNG bytes to a terminal", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }), tty: true });
    const before = stub.requests.length;
    expect(
      await run(["drawing", "render", "abc", "--format", "png"], io.io),
    ).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("--out");
    expect(stub.requests).toHaveLength(before);
  });

  it("render refuses a format the server does not have, without a request", async () => {
    const io = fakeIo({ env: env({ LEXIDRAW_TOKEN: "lxd_good" }) });
    const before = stub.requests.length;
    expect(
      await run(["drawing", "render", "abc", "--format", "pdf"], io.io),
    ).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("--format");
    expect(stub.requests).toHaveLength(before);
  });

  it("schema describes the put operation", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["schema", "drawing put"], io.io)).toBe(0);
    expect(JSON.parse(io.stdout())).toMatchObject({
      command: "drawing put",
      method: "PUT",
      path: "/drawings/{id}",
      operationId: "drawings-put",
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
      known: ["api", "auth", "dir", "doc", "drawing", "schema", "search"],
    });
  });

  it("fails an unknown profile with exit 2", async () => {
    const io = fakeIo({ env: env() });
    expect(await run(["auth", "status", "--profile", "staging"], io.io)).toBe(
      2,
    );
    expect(JSON.parse(io.stderr()).code).toBe("USAGE");
  });

  it("rejects a repeated --profile", async () => {
    const io = fakeIo({ env: env() });
    expect(
      await run(
        ["auth", "status", "--profile", "dev", "--profile", "prod"],
        io.io,
      ),
    ).toBe(2);
    expect(JSON.parse(io.stderr()).message).toContain("more than once");
  });
});
