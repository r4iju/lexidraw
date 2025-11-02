import { drizzle, schema, sql } from "@packages/drizzle";
import { headers } from "next/headers";
import { RequestsChart } from "./_components/requests-chart";

export default async function AdminLlmOverviewPage() {
  // Access request data first to allow using current time
  await headers();
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const from = now - thirtyDaysMs;

  const [agg] = await drizzle
    .select({
      totalEvents: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${schema.llmAuditEvents.totalTokens}), 0)`,
    })
    .from(schema.llmAuditEvents)
    .where(sql`${schema.llmAuditEvents.createdAt} >= ${from}`);

  const latencies = await drizzle
    .select({ latencyMs: schema.llmAuditEvents.latencyMs })
    .from(schema.llmAuditEvents)
    .where(sql`${schema.llmAuditEvents.createdAt} >= ${from}`);

  let p95Latency = 0;
  if (latencies.length > 0) {
    const sorted = latencies.map((l) => l.latencyMs).sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(0.95 * (sorted.length - 1)));
    p95Latency = sorted[idx] ?? 0;
  }

  const byDay = await drizzle
    .select({
      day: sql<string>`strftime('%Y-%m-%d', datetime(${schema.llmAuditEvents.createdAt} / 1000, 'unixepoch'))`,
      count: sql<number>`count(*)`,
    })
    .from(schema.llmAuditEvents)
    .where(sql`${schema.llmAuditEvents.createdAt} >= ${from}`)
    .groupBy(
      sql`strftime('%Y-%m-%d', datetime(${schema.llmAuditEvents.createdAt} / 1000, 'unixepoch'))`,
    )
    .orderBy(
      sql`strftime('%Y-%m-%d', datetime(${schema.llmAuditEvents.createdAt} / 1000, 'unixepoch'))`,
    );

  const chartData = byDay.map((d) => ({
    day: d.day,
    requests: Number(d.count),
  }));

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Total events (30d)</div>
          <div className="mt-2 text-2xl font-medium">
            {agg?.totalEvents ?? 0}
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Total tokens (30d)</div>
          <div className="mt-2 text-2xl font-medium">
            {(agg?.totalTokens ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">p95 latency (30d)</div>
          <div className="mt-2 text-2xl font-medium">
            {p95Latency.toLocaleString()} ms
          </div>
        </div>
      </section>
      <section className="rounded-md border border-border p-4">
        <div className="text-sm font-medium">Requests over time</div>
        <RequestsChart data={chartData} />
      </section>
    </div>
  );
}
