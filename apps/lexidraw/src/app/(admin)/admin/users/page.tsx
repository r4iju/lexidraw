import { Suspense } from "react";
import { api } from "~/trpc/server";
import { UsersDataTable } from "./data-table";
import { z } from "zod";

const SearchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(20),
  query: z.string().optional(),
});

type Props = {
  searchParams: Promise<z.infer<typeof SearchParamsSchema>>;
};

async function AdminUsersContent({ searchParams }: Props) {
  "use cache: private";
  const resolvedSearchParams = await searchParams;
  const { page, size, query } = SearchParamsSchema.parse(resolvedSearchParams);

  const rowsRaw = await api.adminUsers.list.query({ page, size, query });
  const rows = rowsRaw.map((r) => ({
    id: r.id,
    name: (r as { name?: string | null }).name ?? null,
    email: (r as { email?: string | null }).email ?? null,
    roles: JSON.parse(
      (r as unknown as { roles: string }).roles ?? "[]",
    ) as string[],
    isActive: (r as { isActive?: number }).isActive ?? 1,
    createdAt: new Date(
      (r as { createdAt?: number | Date }).createdAt ?? Date.now(),
    ),
    lastActive: (r as { lastActive?: number | Date | null }).lastActive
      ? new Date((r as { lastActive?: number | Date }).lastActive as number)
      : null,
    requests30d: (r as { requests30d?: number }).requests30d ?? 0,
  }));

  return (
    <UsersDataTable rows={rows} page={page} size={size} query={query ?? ""} />
  );
}

export default function AdminUsersPage(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading users…</div>
      }
    >
      <AdminUsersContent {...props} />
    </Suspense>
  );
}
