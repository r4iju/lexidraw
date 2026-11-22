import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Duplex } from "node:stream";
import { test } from "node:test";

test("Workflow's Undici dispatcher can drive Node fetch", async () => {
  const appRequire = createRequire(import.meta.url);
  const workflowRequire = createRequire(appRequire.resolve("workflow/api"));
  const coreRequire = createRequire(
    workflowRequire.resolve("@workflow/core/runtime"),
  );
  const worldRequire = createRequire(
    coreRequire.resolve("@workflow/world-vercel"),
  );
  const { Agent } = worldRequire("undici");

  // Feed an HTTP response through Undici over an in-memory connection.
  const dispatcher = new Agent({
    connect(_options, callback) {
      const connection = new Duplex({
        read() {},
        write(_chunk, _encoding, done) {
          done();
          setImmediate(() => {
            this.push(
              "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
            );
            this.push(null);
          });
        },
      });
      setImmediate(() => callback(null, connection));
    },
  });

  try {
    const response = await fetch("http://workflow.invalid", {
      dispatcher,
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    await dispatcher.destroy();
  }
});
