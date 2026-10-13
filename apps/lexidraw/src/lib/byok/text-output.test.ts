import { expect, test } from "bun:test";
import { createByokSession } from "./session";

const diagnostic =
  "Direct provider access unavailable. Check your key, permissions, or browser connection.";
const key = "synthetic-output-bound-key-291";
function sessionFor(response: Response) {
  const session = createByokSession(async () => response, "https://app.test");
  return { session, reference: session.replace("openrouter", key) };
}
function textResponse(content: string) {
  return Response.json({ choices: [{ message: { content } }] });
}

test("autocomplete rejects the reviewer's oversized output and UTF-8 bytes before publishing a suggestion", async () => {
  for (const content of ["word ".repeat(4000), "界".repeat(400)]) {
    const { session, reference } = sessionFor(textResponse(content));
    await expect(session.autocomplete(reference, "Hello ")).rejects.toThrow(
      diagnostic,
    );
  }
});

test("short text validation has its own output ceiling and accepts bounded multilingual output", async () => {
  const { session, reference } = sessionFor(textResponse("界".repeat(100)));
  await expect(session.text(reference, "Validate")).rejects.toThrow(diagnostic);
  const valid = sessionFor(textResponse("こんにちは"));
  expect(await valid.session.text(valid.reference, "Validate")).toBe(
    "こんにちは",
  );
});

test("multiple choices and truncated JSON never become usable text", async () => {
  for (const response of [
    Response.json({
      choices: [
        { message: { content: "one" } },
        { message: { content: "two" } },
      ],
    }),
    new Response('{"choices":[{"message":{"content":"unfinished'),
  ]) {
    const { session, reference } = sessionFor(response);
    await expect(session.text(reference, "Validate")).rejects.toThrow(
      diagnostic,
    );
  }
});

test("wire overflow is rejected and canceled while reading, before the remaining body is buffered", async () => {
  let reads = 0;
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          if (reads <= 80) controller.enqueue(new Uint8Array(4096).fill(32));
          else controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
  );
  const { session, reference } = sessionFor(response);
  await expect(session.text(reference, "Validate")).rejects.toThrow(diagnostic);
  expect(cancelled).toBe(true);
  expect(reads).toBeLessThan(80);
});

test("cancellation interrupts a pending body read and never returns buffered content", async () => {
  let started: () => void = () => {};
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  let finish: () => void = () => {};
  const abort = new AbortController();
  const { session, reference } = sessionFor(
    new Response(
      new ReadableStream<Uint8Array>(
        {
          start(controller) {
            finish = () => controller.close();
            controller.enqueue(new TextEncoder().encode('{"choices":['));
          },
          pull() {
            started();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    ),
  );
  const result = session.autocomplete(reference, "Hello ", {
    signal: abort.signal,
  });
  const outcome = result.then(
    () => "unexpected output",
    (error: Error) => error.message,
  );
  await reading;
  abort.abort();
  const interrupted = await Promise.race([
    outcome.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  if (!interrupted) finish();
  expect(await outcome).toBe(diagnostic);
  expect(interrupted).toBe(true);
  expect(cancelled).toBe(true);
});
