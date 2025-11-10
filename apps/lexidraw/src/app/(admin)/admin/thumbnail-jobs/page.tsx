import { Suspense } from "react";
import { api } from "~/trpc/server";
import { z } from "zod";
import { ThumbnailJobsDataTable } from "./data-table";
import type { ThumbnailJobRow } from "./columns";

const SearchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  status: z
    .enum(["pending", "processing", "done", "error", "stale", "all"])
    .default("all"),
  sortBy: z
    .enum(["createdAt", "updatedAt", "status", "attempts", "nextRunAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

type Props = {
  searchParams: Promise<z.infer<typeof SearchParamsSchema>>;
};

async function ThumbnailJobsContent({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  const { page, size, status, sortBy, sortOrder } =
    SearchParamsSchema.parse(resolvedSearchParams);

  const [stats, jobsRaw] = await Promise.all([
    api.adminThumbnailJobs.stats.query(),
    api.adminThumbnailJobs.list.query({
      page,
      size,
      status: status === "all" ? undefined : status,
      sortBy,
      sortOrder,
    }),
  ]);

  const rows: ThumbnailJobRow[] = jobsRaw.map((job) => ({
    id: job.id,
    entityId: job.entityId,
    version: job.version,
    status: job.status,
    attempts: job.attempts,
    nextRunAt: job.nextRunAt
      ? job.nextRunAt instanceof Date
        ? job.nextRunAt
        : new Date(job.nextRunAt as number)
      : null,
    lastError: job.lastError,
    createdAt: job.createdAt instanceof Date
      ? job.createdAt
      : new Date(job.createdAt as number),
    updatedAt: job.updatedAt instanceof Date
      ? job.updatedAt
      : new Date(job.updatedAt as number),
  }));

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Total Jobs</div>
          <div className="mt-2 text-2xl font-medium">{stats.total}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Pending</div>
          <div className="mt-2 text-2xl font-medium">{stats.pending}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Processing</div>
          <div className="mt-2 text-2xl font-medium">{stats.processing}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Done</div>
          <div className="mt-2 text-2xl font-medium">{stats.done}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Error</div>
          <div className="mt-2 text-2xl font-medium">{stats.error}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Stale</div>
          <div className="mt-2 text-2xl font-medium">{stats.stale}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Jobs with Errors</div>
          <div className="mt-2 text-2xl font-medium">{stats.errorCount}</div>
        </div>
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-foreground/70">Avg Attempts</div>
          <div className="mt-2 text-2xl font-medium">
            {stats.avgAttempts.toFixed(1)}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border p-4">
        <div className="mb-4 text-sm font-medium">Recent Jobs</div>
        <ThumbnailJobsDataTable
          rows={rows}
          page={page}
          size={size}
          status={status}
          sortBy={sortBy}
          sortOrder={sortOrder}
        />
      </section>
    </div>
  );
}

export default async function ThumbnailJobsPage(props: Props) {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <ThumbnailJobsContent {...props} />
    </Suspense>
  );
}

