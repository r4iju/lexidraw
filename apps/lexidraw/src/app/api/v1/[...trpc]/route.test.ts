/// <reference types="bun" />
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq } from "drizzle-orm";
import { PublicAccess } from "@packages/types";

import { hashApiToken } from "~/server/auth/api-token-format";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();

/**
 * The tags the procedures asked Next to drop. Stubbed rather than observed:
 * `revalidateTag` is a no-op outside a Next server, so the only way to see
 * that a write reached for it is to hold the calls here.
 */
const revalidated: string[] = [];
mock.module("next/cache", () => ({
  revalidateTag: (tag: string) => {
    revalidated.push(tag);
  },
  cacheTag: () => {},
  revalidatePath: () => {},
  updateTag: () => {},
}));

// After the runtime and the stub, so the route's imports find the test
// database and the fake `next/cache` rather than the real ones.
const { GET, POST, PUT, PATCH, DELETE } = await import("./route");

const HANDLERS = { GET, POST, PUT, PATCH, DELETE } as const;

const OWNER = "rest_owner";
const WRITE_TOKEN = "lxd_rest_write";

/** A parsed JSON body; the assertion is what pins its shape down. */
// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON, asserted on below
type Json = Record<string, any>;

async function api(
  method: keyof typeof HANDLERS,
  path: string,
  options: { body?: unknown; contentType?: string | null } = {},
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${WRITE_TOKEN}`,
  };
  const contentType =
    options.contentType === undefined
      ? "application/json"
      : options.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  const response = await HANDLERS[method](
    new Request(`http://lexidraw.test/api/v1${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await response.text();
  return { response, body: (text ? JSON.parse(text) : {}) as Json };
}

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "rest-owner@example.test" },
    { id: "rest_friend", name: "Friend", email: "rest-friend@example.test" },
  ]);
  await db.insert(schema.apiTokens).values([
    {
      id: "tok_rest_write",
      userId: OWNER,
      name: "write",
      tokenHash: hashApiToken(WRITE_TOKEN),
      scope: "write",
    },
  ]);
  await db.insert(schema.entities).values([
    row("rest_dir", "Inbox", "{}", "directory"),
    row("rest_doc", "Notes", JSON.stringify(EMPTY_DOCUMENT), "document", {
      parentId: "rest_dir",
    }),
    row("rest_draw", "Sketch", "[]", "drawing", { parentId: "rest_dir" }),
    row("rest_sub", "Nested", "{}", "directory", { parentId: "rest_dir" }),
  ]);
});

beforeEach(() => {
  revalidated.length = 0;
});

function row(
  id: string,
  title: string,
  elements: string,
  entityType: string,
  overrides: { parentId?: string } = {},
) {
  return {
    id,
    title,
    elements,
    entityType,
    userId: OWNER,
    publicAccess: PublicAccess.PRIVATE,
    parentId: overrides.parentId ?? null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

/** A stored editor state holding one empty paragraph. */
const EMPTY_DOCUMENT = {
  root: {
    children: [
      {
        key: "1",
        type: "paragraph",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        children: [],
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
    key: "root",
  },
};

describe("a wrong method on a live path", () => {
  test("is 405 with the methods the path does serve", async () => {
    const { response, body } = await api("POST", "/me", { body: {} });
    expect(response.status).toBe(405);
    expect(body.code).toBe("METHOD_NOT_SUPPORTED");
    expect(response.headers.get("allow")).toBe("GET");
    expect(body.message).toContain("/me");
  });

  test("names every method a parameterised path serves", async () => {
    const { response } = await api("POST", "/entities/rest_doc", { body: {} });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("DELETE, GET, PATCH, PUT");
  });

  test("leaves a path nobody publishes at 404", async () => {
    const { response, body } = await api("GET", "/nothing-here");
    expect(response.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  test("serves HEAD wherever it serves GET", async () => {
    // Next answers HEAD with the exported GET, so the refusal sees a method
    // the document never lists on its own.
    const response = await GET(
      new Request("http://lexidraw.test/api/v1/me", {
        method: "HEAD",
        headers: { authorization: `Bearer ${WRITE_TOKEN}` },
      }),
    );
    // The adapter answers a HEAD with the headers and no body, as it did
    // before the refusal existed; what matters is that it is not refused.
    expect(response.status).toBe(204);
  });

  test("lets the method the path does serve through", async () => {
    const { response, body } = await api("GET", "/me");
    expect(response.status).toBe(200);
    expect(body.userId).toBe(OWNER);
  });
});

describe("a body the endpoint cannot read", () => {
  test("is 415 with the type quoted, and closed", async () => {
    const { response, body } = await api("PUT", "/entities/rest_doc", {
      body: {},
      contentType: "text/plain",
    });
    expect(response.status).toBe(415);
    expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(body.message).toContain('"text/plain"');
    // Every quote in the message opens and closes.
    expect(body.message.split('"').length % 2).toBe(1);
  });

  test("says so when the header is missing altogether", async () => {
    const { response, body } = await api("POST", "/entities", {
      body: {},
      contentType: null,
    });
    expect(response.status).toBe(415);
    expect(body.message).toBe("Missing content-type header");
  });
});

describe("an entity that is not there", () => {
  test("is named an entity, whatever type the caller had in mind", async () => {
    const { response, body } = await api("GET", "/entities/missing");
    expect(response.status).toBe(404);
    expect(body.message).toBe("Entity not found");
  });

  test("is named an entity on a delete too", async () => {
    const { body } = await api("DELETE", "/entities/missing");
    expect(body.message).toBe("Entity not found");
  });
});

describe("a share that is not there", () => {
  test("is not found when its access level is changed", async () => {
    const { response, body } = await api(
      "PATCH",
      "/entities/rest_draw/shares/rest_friend",
      { body: { accessLevel: "READ" } },
    );
    expect(response.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("Share not found");
  });

  test("is not found when it is revoked", async () => {
    const { response, body } = await api(
      "DELETE",
      "/entities/rest_draw/shares/rest_friend",
    );
    expect(response.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("Share not found");
  });

  test("is what a revoke leaves, so repeating one is not found", async () => {
    const path = "/entities/rest_sub/shares/rest_friend";
    await api("POST", "/entities/rest_sub/shares", {
      body: { userEmail: "rest-friend@example.test", accessLevel: "EDIT" },
    });
    const changed = await api("PATCH", path, { body: { accessLevel: "READ" } });
    expect(changed.response.status).toBe(200);
    const revoked = await api("DELETE", path);
    expect(revoked.response.status).toBe(200);
    const again = await api("DELETE", path);
    expect(again.response.status).toBe(404);
  });
});

describe("a write over the API", () => {
  test("drops the cached renders of the entity and its directory", async () => {
    const { response } = await api(
      "POST",
      "/documents/rest_doc/markdown/append",
      {
        body: { markdown: "## Added out of band" },
      },
    );
    expect(response.status).toBe(200);
    expect(revalidated).toEqual(["entity:rest_doc", "entity:rest_dir"]);
  });

  test("drops them for a rename as well", async () => {
    const { response } = await api("PATCH", "/entities/rest_doc", {
      body: { title: "Renamed over REST" },
    });
    expect(response.status).toBe(200);
    expect(revalidated).toContain("entity:rest_doc");
    expect(revalidated).toContain("entity:rest_dir");
  });

  test("drops them for a create, under the directory it landed in", async () => {
    const { response, body } = await api("POST", "/entities", {
      body: {
        id: "rest_doc_new",
        title: "Made over REST",
        entityType: "document",
        elements: JSON.stringify(EMPTY_DOCUMENT),
        parentId: "rest_dir",
      },
    });
    expect(response.status).toBe(200);
    expect(body.id).toBe("rest_doc_new");
    expect(revalidated).toEqual(["entity:rest_doc_new", "entity:rest_dir"]);
  });

  test("drops them for a delete", async () => {
    await api("POST", "/entities", {
      body: {
        id: "rest_doc_doomed",
        title: "Briefly",
        entityType: "document",
        elements: JSON.stringify(EMPTY_DOCUMENT),
        parentId: "rest_dir",
      },
    });
    revalidated.length = 0;
    const { response } = await api("DELETE", "/entities/rest_doc_doomed");
    expect(response.status).toBe(200);
    expect(revalidated).toEqual(["entity:rest_doc_doomed", "entity:rest_dir"]);
  });
});

describe("a write that changes a listing", () => {
  test("drops the listing above the directory it landed in", async () => {
    const { response } = await api("POST", "/entities", {
      body: {
        id: "rest_doc_nested",
        title: "Filed two deep",
        entityType: "document",
        elements: JSON.stringify(EMPTY_DOCUMENT),
        parentId: "rest_sub",
      },
    });
    expect(response.status).toBe(200);
    // The listing of `rest_dir` renders how many children `rest_sub` has.
    expect(revalidated).toEqual([
      "entity:rest_doc_nested",
      "entity:rest_sub",
      "entity:rest_dir",
    ]);
  });

  test("drops the listing when a share changes, not just the entity", async () => {
    const { response, body } = await api("POST", "/entities/rest_doc/shares", {
      body: {
        userEmail: "rest-friend@example.test",
        accessLevel: "EDIT",
      },
    });
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // The listing renders how many people an entity is shared with.
    expect(revalidated).toEqual(["entity:rest_doc", "entity:rest_dir"]);
  });
});

describe("the tag list", () => {
  const tags = async () => (await api("GET", "/tags")).body as string[];

  test("leaves out a tag whose only entity is in the trash, until it is restored", async () => {
    const created = await api("POST", "/entities", {
      body: {
        id: "rest_doc_trashed_tag",
        title: "Tagged then trashed",
        entityType: "document",
        elements: JSON.stringify(EMPTY_DOCUMENT),
        parentId: null,
      },
    });
    expect(created.response.status).toBe(200);
    for (const [id, tag] of [
      ["rest_doc_trashed_tag", "rest-only-in-trash"],
      ["rest_doc", "rest-still-live"],
    ]) {
      const tagged = await api("PUT", `/entities/${id}/tags`, {
        body: { tagNames: [tag] },
      });
      expect(tagged.response.status).toBe(200);
    }
    expect(await tags()).toContain("rest-only-in-trash");

    const deleted = await api("DELETE", "/entities/rest_doc_trashed_tag");
    expect(deleted.response.status).toBe(200);
    expect(await tags()).not.toContain("rest-only-in-trash");
    expect(await tags()).toContain("rest-still-live");

    // Nothing publishes a restore yet; clearing the stamp is all one would do.
    await db
      .update(schema.entities)
      .set({ deletedAt: null })
      .where(eq(schema.entities.id, "rest_doc_trashed_tag"));
    expect(await tags()).toContain("rest-only-in-trash");
  });

  test("leaves out a tag on an entity the caller can no longer reach", async () => {
    // What an unshare leaves behind: the friend's tag on an entity they no
    // longer see, which a tag filter would answer with nothing.
    const friendToken = "lxd_rest_friend_read";
    await db.insert(schema.apiTokens).values({
      id: "tok_rest_friend_read",
      userId: "rest_friend",
      name: "read",
      tokenHash: hashApiToken(friendToken),
      scope: "read",
    });
    await db
      .insert(schema.tags)
      .values({ id: "tag_rest_unreachable", name: "rest-unreachable" });
    await db.insert(schema.entityTags).values({
      entityId: "rest_draw",
      tagId: "tag_rest_unreachable",
      userId: "rest_friend",
    });
    const response = await GET(
      new Request("http://lexidraw.test/api/v1/tags", {
        headers: { authorization: `Bearer ${friendToken}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toContain("rest-unreachable");
  });
});

describe("a drawing", () => {
  test("reports how many elements a create actually stored", async () => {
    const { response, body } = await api("POST", "/drawings", {
      // One shorthand box carrying a label, which the converter stores as the
      // box and a text element of its own.
      body: {
        title: "From shorthand",
        elements: [
          {
            type: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 60,
            label: { text: "Ingest" },
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(body.elementCount).toBe(2);
    expect(revalidated).toContain(`entity:${body.id}`);
  });

  test("names a drawing a drawing when it lost the race", async () => {
    const { response, body } = await api("PUT", "/drawings/rest_draw", {
      body: {
        elements: [],
        ifUnmodifiedSince: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(response.status).toBe(409);
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toStartWith("Drawing was modified at ");
  });

  // The CLI's `drawing put <id>` sends any id straight here, trusting this.
  test("is not found when the id is another kind of entity", async () => {
    const { response, body } = await api("PUT", "/drawings/rest_doc", {
      body: { elements: [], ifUnmodifiedSince: "2020-01-01T00:00:00.000Z" },
    });
    expect(response.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("a document rendered to PDF", () => {
  const READER = "rest_reader";
  const READ_TOKEN = "lxd_rest_reader_read";
  const STRANGER_TOKEN = "lxd_rest_stranger_read";

  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: READER, name: "Reader", email: "rest-reader@example.test" },
      {
        id: "rest_stranger",
        name: "Stranger",
        email: "rest-stranger@example.test",
      },
    ]);
    await db.insert(schema.apiTokens).values([
      {
        id: "tok_rest_reader",
        userId: READER,
        name: "read",
        tokenHash: hashApiToken(READ_TOKEN),
        scope: "read",
      },
      {
        id: "tok_rest_stranger",
        userId: "rest_stranger",
        name: "read",
        tokenHash: hashApiToken(STRANGER_TOKEN),
        scope: "read",
      },
    ]);
    await db
      .insert(schema.entities)
      .values(
        row(
          "rest_printed",
          "Q3 <plan>",
          JSON.stringify(EMPTY_DOCUMENT),
          "document",
        ),
      );
    await db.insert(schema.sharedEntities).values({
      id: "share_rest_printed",
      entityId: "rest_printed",
      userId: READER,
      accessLevel: "READ",
    });
  });

  /** What the page renderer was asked for; it answers with a stand-in PDF. */
  let rendered: Json[] = [];
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    rendered = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      rendered.push(JSON.parse(String(init?.body)));
      return new Response("%PDF-1.7 stand-in", {
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function render(token: string, query: string) {
    const response = await GET(
      new Request(
        `http://lexidraw.test/api/v1/documents/rest_printed/render?${query}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            host: "attacker.test",
            "x-forwarded-proto": "https",
          },
        },
      ),
    );
    return { response, body: (await response.json()) as Json };
  }

  test("reaches someone it is shared with to read, on a read-only token", async () => {
    const { response, body } = await render(READ_TOKEN, "format=pdf");
    expect(response.status).toBe(200);
    expect(body.contentType).toBe("application/pdf");
    expect(body.encoding).toBe("base64");
    expect(Buffer.from(body.data, "base64").toString()).toBe(
      "%PDF-1.7 stand-in",
    );
    expect(body.updatedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  test("prints the page the reader could open, for this document only", async () => {
    await render(READ_TOKEN, "format=pdf");
    const page = new URL(rendered[0]?.url);
    expect(page.origin).toBe(new URL(process.env.NEXTAUTH_URL || "").origin);
    expect(page.pathname).toBe("/documents/rest_printed/print");
    const { verifyPrintToken } = await import("~/server/auth/print-token");
    expect(
      verifyPrintToken(page.searchParams.get("token") ?? ""),
    ).toMatchObject({ entityId: "rest_printed", userId: READER });
  });

  test("renders PNG at the requested width and theme through the same operation", async () => {
    const { response, body } = await render(
      READ_TOKEN,
      "format=png&width=375&theme=dark",
    );
    expect(response.status).toBe(200);
    expect(body.contentType).toBe("image/png");
    expect(body.format).toBe("png");
    expect(body.encoding).toBe("base64");
    expect(rendered[0]).toMatchObject({
      viewport: { width: 375, deviceScaleFactor: 1 },
      theme: "dark",
      image: { type: "png" },
      waitForDocument: true,
      maxPixels: 16_000_000,
    });
    expect(new URL(rendered[0]?.url).pathname).toBe(
      "/screenshot/view/rest_printed",
    );
  });

  test("rejects invalid PNG widths before reaching the worker", async () => {
    for (const width of ["0", "1", "319", "4097", "16000001", "375.5"]) {
      expect(
        (await render(READ_TOKEN, `format=png&width=${width}`)).response.status,
      ).toBe(400);
    }
    expect(rendered).toEqual([]);
  });

  test("reports a PNG exceeding the worker pixel limit as 413", async () => {
    globalThis.fetch = (async (_url: string, _init?: RequestInit) =>
      new Response("Image exceeds 16 megapixels", {
        status: 413,
      })) as typeof fetch;
    expect((await render(READ_TOKEN, "format=png")).response.status).toBe(413);
  });

  test("refuses a PNG whose base64 response exceeds 3 MB", async () => {
    globalThis.fetch = (async (_url: string, _init?: RequestInit) =>
      new Response(new Uint8Array(2_250_001))) as typeof fetch;
    expect((await render(READ_TOKEN, "format=png")).response.status).toBe(413);
  });

  test("is A4 portrait unless asked otherwise", async () => {
    await render(READ_TOKEN, "format=pdf");
    await render(READ_TOKEN, "format=pdf&paper=Letter&orientation=landscape");
    expect(
      rendered.map(({ format, orientation }) => [format, orientation]),
    ).toEqual([
      ["A4", "portrait"],
      ["Letter", "landscape"],
    ]);
  });

  test("heads each page with the title, as text rather than markup", async () => {
    await render(READ_TOKEN, "format=pdf");
    expect(rendered[0]?.headerTemplate).toContain("Q3 &lt;plan&gt;");
    expect(rendered[0]?.headerTemplate).toContain("padding: 0 18mm");
    expect(rendered[0]?.headerTemplate).not.toContain("<plan>");
  });

  test("is not found for someone it is not shared with, who prints nothing", async () => {
    const { response, body } = await render(STRANGER_TOKEN, "format=pdf");
    expect(response.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(rendered).toEqual([]);
  });
});
