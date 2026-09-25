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

test("rejects transitions of layout or everything, and raw durations and easings", async () => {
  const result = await lint(
    'export const view = <div className="transition hover:transition-all transition-[padding] duration-300 ease-in-out" />;',
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("transition: `transition`");
  expect(result.output).toContain("transition: `hover:transition-all`");
  expect(result.output).toContain("transition: `transition-[padding]`");
  expect(result.output).toContain("duration: `duration-300`");
  expect(result.output).toContain("easing: `ease-in-out`");
});

test("accepts colour, opacity and transform transitions on the design's timings", async () => {
  const result = await lint(
    'export const view = <div className="transition-colors transition-[color,opacity,transform] data-[state=open]:duration-base duration-fast ease-enter transition-none duration-0" />;',
  );
  expect(result.output).not.toMatch(/transition|duration|easing/);
  expect(result.code).toBe(0);
});

test("checks CSS transitions as well as classes", async () => {
  const rejected = await lint(
    ".a { transition: width 200ms; } .b { transition: opacity 120ms; } .c { transition: var(--transition-duration-fast); }",
    "css",
  );
  expect(rejected.code).toBe(1);
  expect(rejected.output.trim().split("\n")).toHaveLength(4);
  const accepted = await lint(
    ".a { transition: opacity var(--transition-duration-fast) var(--ease-enter), transform var(--transition-duration-base); } .b { transition: none; }",
    "css",
  );
  expect(accepted.output).not.toMatch(/transition|duration/);
  expect(accepted.code).toBe(0);
});

test("rejects a placeholder that pulses at once instead of the shared skeleton", async () => {
  const result = await lint(
    'export const view = <div className="size-10 animate-pulse rounded-md bg-muted" />;',
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("skeleton: `animate-pulse`");
});
