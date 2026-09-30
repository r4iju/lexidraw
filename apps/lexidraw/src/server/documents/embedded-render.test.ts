import { expect, test } from "bun:test";
import { createEmbedRenderer } from "./embedded-render";

test("renders once per source and theme, sharing concurrent requests", async () => {
  let calls = 0;
  const render = createEmbedRenderer(async (request) => {
    calls++;
    return { svg: `<svg>${request.theme}</svg>`, png: "aGVsbG8=", width: 100, height: 40 };
  });
  const input = { node: { type: "mermaid", schema: "graph TD; A-->B" }, theme: "light" as const, width: 400, fontFamily: "Arial", fontSize: 16 };
  const [first, second] = await Promise.all([render(input), render(input)]);
  expect(first).toEqual(second);
  expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(calls).toBe(1);
  const dark = await render({ ...input, theme: "dark" });
  expect(dark.hash).not.toBe(first.hash);
  const edited = await render({ ...input, node: { ...input.node, schema: "graph TD; A-->C" } });
  expect(edited.hash).not.toBe(first.hash);
  expect(calls).toBe(3);
});

test("bounds active renders and rejects excess queued requests", async () => {
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const render = createEmbedRenderer(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return { svg: "<svg/>", png: "aGVsbG8=", width: 100, height: 40 };
  });
  const input = { node: { type: "mermaid" }, theme: "light" as const, width: 400, fontFamily: "Arial", fontSize: 16 };
  const pending = Array.from({ length: 14 }, (_, i) => render({ ...input, node: { ...input.node, schema: String(i) } }));
  const excess = render({ ...input, node: { ...input.node, schema: "excess" } });
  const excessResult = excess.then(() => "accepted", (error: Error) => error.message);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(active).toBe(2);
  for (let i = 0; i < 14; i++) {
    while (releases.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.all(pending);
  expect(await excessResult).toBe("Render queue is full");
  expect(peak).toBe(2);
});
