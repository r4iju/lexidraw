import { afterAll, beforeAll, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { PNG } from "pngjs";
import { POST as preview } from "./route";

const SECRET = "shared-with-the-app";
const env = process.env as Record<string, string | undefined>;
beforeAll(() => {
  env.RENDER_WORKER_SECRET = SECRET;
});
afterAll(() => {
  delete env.RENDER_WORKER_SECRET;
});

const STATIC = {
  html: "<h3>Static</h3><p>Plain text</p>",
  description: "Static",
  height: 180,
};

function capture(body: object) {
  return preview(
    new NextRequest("https://worker.test/api/html-block-preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

test("captures beyond the concurrency limit wait for a turn instead of failing", async () => {
  const answers = await Promise.all(
    [0, 1, 2, 3].map(() => capture({ source: STATIC, width: 320 })),
  );

  expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
}, 60_000);

async function pixels(answer: Response) {
  expect(answer.status).toBe(200);
  const png = PNG.sync.read(Buffer.from(await answer.arrayBuffer()));
  const at = (x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return [...png.data.subarray(i, i + 4)];
  };
  const opaque: number[] = [];
  for (let i = 0; i < png.data.length; i += 4)
    if ((png.data[i + 3] ?? 0) > 200)
      opaque.push(
        ((png.data[i] ?? 0) + (png.data[i + 1] ?? 0) + (png.data[i + 2] ?? 0)) /
          3,
      );
  return { corner: at(2, 2), opaque };
}

test.each([
  ["light", (ink: number[]) => Math.max(...ink) < 90],
  ["dark", (ink: number[]) => Math.min(...ink) > 160],
] as const)(
  "a %s capture is the document's ink on a transparent surface",
  async (theme, readable) => {
    const { corner, opaque } = await pixels(
      await capture({ source: STATIC, width: 320, theme }),
    );

    expect(corner[3]).toBe(0);
    expect(opaque.length).toBeGreaterThan(20);
    expect(readable(opaque)).toBe(true);
  },
  30_000,
);

test.each([
  ["light", [250, 240, 200, 255]],
  ["dark", [10, 20, 30, 255]],
] as const)(
  "a block's own background and colour-scheme rules win (%s)",
  async (theme, background) => {
    const { corner } = await pixels(
      await capture({
        source: {
          ...STATIC,
          css: "body{background:rgb(250,240,200)}@media (prefers-color-scheme: dark){body{background:rgb(10,20,30)}}",
        },
        width: 320,
        theme,
      }),
    );

    expect(corner).toEqual([...background]);
  },
  30_000,
);
