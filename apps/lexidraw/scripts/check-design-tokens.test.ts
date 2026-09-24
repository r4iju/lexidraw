import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function lint(source: string, extension = "tsx") {
  const dir = await mkdtemp(join(tmpdir(), "design-tokens-"));
  const file = join(dir, `sample.${extension}`);
  try {
    await writeFile(file, source);
    const child = Bun.spawn(
      [
        "bun",
        new URL("./check-design-tokens.ts", import.meta.url).pathname,
        file,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    return {
      code: await child.exited,
      output: await new Response(child.stdout).text(),
    };
  } finally {
    await rm(dir, { recursive: true });
  }
}

test("rejects raw presentation colours, colourless borders and a second icon family", async () => {
  const result = await lint(
    'import { SunIcon } from "@radix-ui/react-icons"; export const view = <div className="hover:bg-violet-500 border-t" style={{color: "#fff"}} />;',
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("raw colour");
  expect(result.output).toContain("border colour");
  expect(result.output).toContain("Lucide");
});

test("accepts semantic colours and variant borders", async () => {
  const result = await lint(
    'export const view = <div className="border border-input hover:border-ring before:border-2 before:border-primary" style={{color: "var(--primary)"}} />;',
  );
  expect(result.code).toBe(0);
});

test("checks CSS declarations as well as classes", async () => {
  const result = await lint(
    ".menu { background: rgb(255 0 0); border: 1px solid; }",
    "css",
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("raw colour");
  expect(result.output).toContain("border colour");
});
