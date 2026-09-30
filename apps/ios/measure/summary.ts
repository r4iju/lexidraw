/**
 * Summarizes `scripts/measure-scroll.sh`'s runs: each document's scroll
 * report from the harness, with what its Instruments trace saw of the same
 * frames. Writes `summary.json` next to them and prints a table.
 *
 *   bun measure/summary.ts <dir> <document>...
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Percentiles = { p50: number; p95: number; p99: number; max: number };

type Report = {
  document: string;
  contentHeight: number;
  loadMs: number;
  makingTheViewMs: number;
  viewToFirstScreenMs: number;
  openToFirstScreenMs: number;
  jumpToTheMiddleMs: number;
  frames: number;
  hitches: number;
  hitchTimeMs: number;
  intervalMs: Percentiles;
  workMs: Percentiles;
  workByPhaseMs: Record<string, Percentiles>;
  jumps: number;
  largestJumps: { phase: string; offset: number; by: number }[];
  memoryMB: Record<string, number>;
};

const [given, ...runs] = process.argv.slice(2);
if (!given || runs.length === 0)
  throw new Error("usage: bun measure/summary.ts <dir> <document>...");
const dir = given;

/** One column of a table in the trace, in nanoseconds, by row. */
function column(
  trace: string,
  schema: string,
  element: string,
): { values: number[]; names: string[] } {
  const exported = Bun.spawnSync([
    "xcrun",
    "xctrace",
    "export",
    "--input",
    trace,
    "--xpath",
    `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
  ]);
  if (exported.exitCode !== 0)
    throw new Error(
      `Couldn't export ${schema} from ${trace}: ${exported.stderr}`,
    );
  const xml = exported.stdout.toString();
  // Values repeat as references to the first element with the same id.
  const byId = new Map<string, string>();
  for (const [, id, value] of xml.matchAll(/<[\w-]+ id="(\d+)"[^>]*>([^<]*)</g))
    byId.set(id ?? "", value ?? "");
  const cell = (row: string, name: string) => {
    const match = row.match(
      new RegExp(`<${name} (?:id="\\d+"[^>]*>([^<]*)<|ref="(\\d+)")`),
    );
    return match ? (match[1] ?? byId.get(match[2] ?? "") ?? "") : "";
  };
  const rows = [...xml.matchAll(/<row>(.*?)<\/row>/gs)].map(
    (match) => match[1] ?? "",
  );
  return {
    values: rows.map((row) => Number(cell(row, element))),
    names: rows.map((row) => cell(row, "signpost-name")),
  };
}

function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted.length === 0
      ? 0
      : (sorted[
          Math.min(
            Math.round((sorted.length - 1) * fraction),
            sorted.length - 1,
          )
        ] ?? 0);
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1) ?? 0,
  };
}

const ms = (nanoseconds: number) => nanoseconds / 1e6;
const round = (value: number) => Math.round(value * 100) / 100;
const rounded = (p: Percentiles): Percentiles => ({
  p50: round(p.p50),
  p95: round(p.p95),
  p99: round(p.p99),
  max: round(p.max),
});

async function summarize(run: string) {
  const report: Report = JSON.parse(
    await readFile(join(dir, `${run}.json`), "utf8"),
  );
  const trace = join(dir, `${run}.trace`);
  const commits = column(
    trace,
    "coreanimation-commit-interval",
    "duration",
  ).values.map(ms);
  const starts = column(
    trace,
    "coreanimation-commit-interval",
    "start-time",
  ).values;
  const gaps = starts
    .slice(1)
    .map((start, index) => ms(start - (starts[index] ?? start)));
  const signposts = column(trace, "OSSignpostIntervals", "duration");
  const frames = signposts.values
    .filter((_, index) => signposts.names[index] === "frame")
    .map(ms);
  const hangs = column(trace, "potential-hangs", "duration").values.map(ms);
  const renderingHitches = column(trace, "hitches", "duration").values.map(ms);
  // The display's frame, as the harness saw it.
  const frame = report.intervalMs.p50;
  return {
    document: report.document,
    firstScreen: {
      loadMs: round(report.loadMs),
      makingTheViewMs: round(report.makingTheViewMs),
      viewToFirstScreenMs: round(report.viewToFirstScreenMs),
      openToFirstScreenMs: round(report.openToFirstScreenMs),
    },
    scroll: {
      frames: report.frames,
      contentHeight: Math.round(report.contentHeight),
      jumpToTheMiddleMs: round(report.jumpToTheMiddleMs),
      frameMs: round(frame),
      hitches: report.hitches,
      hitchTimeMs: round(report.hitchTimeMs),
      intervalMs: rounded(report.intervalMs),
      workMs: rounded(report.workMs),
      workByPhaseMs: Object.fromEntries(
        Object.entries(report.workByPhaseMs).map(([phase, p]) => [
          phase,
          rounded(p),
        ]),
      ),
    },
    instruments: {
      frameSignpostMs: rounded(percentiles(frames)),
      commits: commits.length,
      commitMs: rounded(percentiles(commits)),
      commitsOverHalfAFrame: commits.filter((duration) => duration > frame / 2)
        .length,
      commitGapsOverAFrameAndAHalf: gaps.filter((gap) => gap > frame * 1.5)
        .length,
      hangs: hangs.length,
      longestHangMs: round(Math.max(0, ...hangs)),
      renderingHitches: renderingHitches.length,
      renderingHitchTimeMs: round(
        renderingHitches.reduce((total, duration) => total + duration, 0),
      ),
      renderingHitchMs: rounded(percentiles(renderingHitches)),
    },
    stability: { jumps: report.jumps, largestJumps: report.largestJumps },
    memoryMB: Object.fromEntries(
      Object.entries(report.memoryMB).map(([when, mb]) => [when, round(mb)]),
    ),
  };
}

const summary = await Promise.all(runs.map(summarize));

await writeFile(
  join(dir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
const rows: [string, (entry: (typeof summary)[number]) => string | number][] = [
  ["load (ms)", (s) => s.firstScreen.loadMs],
  ["making the view (ms)", (s) => s.firstScreen.makingTheViewMs],
  ["view to first screen (ms)", (s) => s.firstScreen.viewToFirstScreenMs],
  ["open to first screen (ms)", (s) => s.firstScreen.openToFirstScreenMs],
  ["jump to the middle (ms)", (s) => s.scroll.jumpToTheMiddleMs],
  ["frames scrolled", (s) => s.scroll.frames],
  ["late frames", (s) => s.scroll.hitches],
  ["late time (ms)", (s) => s.scroll.hitchTimeMs],
  [
    "frame interval p99 / max (ms)",
    (s) => `${s.scroll.intervalMs.p99} / ${s.scroll.intervalMs.max}`,
  ],
  [
    "work p50 / p95 / p99 / max (ms)",
    (s) => Object.values(s.scroll.workMs).join(" / "),
  ],
  [
    "commits p95 / max (ms)",
    (s) => `${s.instruments.commitMs.p95} / ${s.instruments.commitMs.max}`,
  ],
  ["commits over half a frame", (s) => s.instruments.commitsOverHalfAFrame],
  [
    "commit gaps over 1.5 frames",
    (s) => s.instruments.commitGapsOverAFrameAndAHalf,
  ],
  ["hangs", (s) => s.instruments.hangs],
  ["jumps", (s) => s.stability.jumps],
  [
    "memory first screen / peak (MB)",
    (s) => `${s.memoryMB.firstScreen} / ${s.memoryMB.peak}`,
  ],
];
console.log(`| | ${summary.map((s) => s.document).join(" | ")} |`);
console.log(`|---|${summary.map(() => "---:").join("|")}|`);
for (const [label, value] of rows)
  console.log(`| ${label} | ${summary.map(value).join(" | ")} |`);
console.log(`\n${join(dir, "summary.json")}`);
