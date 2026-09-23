/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
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
  await db
    .insert(schema.users)
    .values([{ id: OWNER, name: "Owner", email: "rest-owner@example.test" }]);
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
});
