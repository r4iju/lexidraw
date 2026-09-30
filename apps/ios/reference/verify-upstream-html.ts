import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlOracle } from "./html-oracle.js";

// Explicit local verification only: public upstream payloads are downloaded to
// a temporary directory, never vendored or requested by the ordinary test suite.
const root = new URL("../", import.meta.url);
const directory = new URL(
  "Tests/LexicalSwiftTests/Fixtures/HTML/upstream/",
  root,
);
const provenance: {
  fixtures: { name: string; source: string; sha256: string; bytes?: number }[];
} = await Bun.file(new URL("disposable-verification.json", directory)).json();
const browser: {
  cases: { name: string; inputSHA256: string; oracleNodesSHA256: string }[];
} = await Bun.file(new URL("chromium-verification.json", directory)).json();

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

const temporary = await mkdtemp(join(tmpdir(), "lexidraw-upstream-html-"));
try {
  const fixtures = [];
  for (const source of provenance.fixtures) {
    if (
      !source.source.startsWith("https://github.com/ckeditor/ckeditor5/blob/")
    )
      continue;
    const expected = browser.cases.find((item) => item.name === source.name);
    if (!expected || expected.inputSHA256 !== source.sha256)
      throw new Error(`Missing independent Chromium digest for ${source.name}`);
    const rawURL = source.source
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      .replace("/blob/", "/");
    const response = await fetch(rawURL);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${source.name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length > 2 * 1024 * 1024 ||
      (source.bytes !== undefined && bytes.length !== source.bytes) ||
      sha256(bytes) !== source.sha256
    )
      throw new Error(`Upstream input digest/size mismatch: ${source.name}`);
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const nodes = htmlOracle(html);
    // Bun's DOM is not accepted as browser ground truth. Its complete node
    // result must equal the frozen real-Chromium digest before native replay.
    if (sha256(JSON.stringify(canonical(nodes))) !== expected.oracleNodesSHA256)
      throw new Error(`Real-browser converter digest mismatch: ${source.name}`);
    fixtures.push({ name: source.name, html, nodes });
    console.log(`${source.name}: pinned input and Chromium node digests agree`);
  }
  if (fixtures.length !== 5)
    throw new Error("Expected three Google Docs and two Word source payloads");
  const fixturePath = join(temporary, "fixtures.json");
  await Bun.write(fixturePath, JSON.stringify(fixtures));
  const replay = Bun.spawn(
    [
      "swift",
      "test",
      "--filter",
      "HTMLPasteTests.recordedDOMOracleAgreesWithNativePaste",
    ],
    {
      cwd: root.pathname,
      env: { ...process.env, HTML_UPSTREAM_FIXTURE_PATH: fixturePath },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const result = await replay.exited;
  if (result !== 0) throw new Error(`Native upstream replay exited ${result}`);
  console.log(
    "All five authentic upstream clipboard payloads agree with native paste",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
