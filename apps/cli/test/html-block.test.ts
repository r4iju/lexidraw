import { expect, test } from "bun:test";
import { run } from "../src/cli";
import { fakeIo, startStub } from "./helpers";
test("block source writes require a document concurrency precondition before touching credentials", async () => {
  const io = fakeIo({ stdin: '{"html":"<p>Hi</p>","description":"Greeting"}' });
  const result = await run(
    ["doc", "block", "create", "doc-one", "--file", "-", "--at-block", "0"],
    io.io,
  );
  expect(result).not.toBe(0);
  expect(io.stderr()).toContain("--if-unmodified-since");
  expect(io.lookups).toEqual([]);
});
test("preview explicitly identifies the saved revision", async () => {
  const io = fakeIo();
  await run(
    [
      "doc",
      "block",
      "preview",
      "doc-one",
      "--block-id",
      "10000000-0000-4000-8000-000000000001",
    ],
    io.io,
  );
  expect(io.stderr()).toContain("--revision");
  expect(io.lookups).toEqual([]);
});

test("block deletion sends its guarded precondition as a DELETE query parameter", async () => {
  const expected = "2026-09-30T13:00:00.000Z";
  const stub = startStub((url, request) => {
    if (url.pathname.endsWith("/openapi.json"))
      return Response.json({ info: { title: "Lexidraw API" } });
    if (request.method === "DELETE")
      return url.searchParams.get("ifUnmodifiedSince") === expected
        ? Response.json({ id: "doc-one", updatedAt: expected })
        : Response.json(
            { message: "Missing query precondition" },
            { status: 400 },
          );
    return Response.json({ message: "Unknown route" }, { status: 404 });
  });
  try {
    const io = fakeIo({
      env: { LEXIDRAW_URL: stub.baseUrl, LEXIDRAW_TOKEN: "lxd_test" },
    });
    const result = await run(
      [
        "doc",
        "block",
        "delete",
        "doc-one",
        "--block-id",
        "10000000-0000-4000-8000-000000000001",
        "--if-unmodified-since",
        expected,
      ],
      io.io,
    );
    expect(result).toBe(0);
    expect(
      stub.requests.find((request) => request.method === "DELETE")?.body,
    ).toBe("");
  } finally {
    stub.stop();
  }
});
