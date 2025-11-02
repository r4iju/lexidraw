import { Suspense } from "react";
import { api } from "~/trpc/server";
import { EntitiesDataTable } from "./data-table";
import { z } from "zod";
import AdminEntitiesSkeleton from "./skeleton";

const SearchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  query: z.string().default(""),
  status: z.enum(["active", "inactive", "all"]).default("all"),
  ownerId: z.string().default(""),
});

type Props = {
  searchParams: Promise<z.infer<typeof SearchParamsSchema>>;
};

async function AdminEntitiesContent({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  const { page, size, query, status, ownerId } =
    SearchParamsSchema.parse(resolvedSearchParams);

  const rowsRaw = await api.adminEntities.list.query({
    page,
    size,
    query,
    status: status === "all" ? undefined : status,
    ownerId: ownerId || undefined,
  });
  const ownersRaw = await api.adminUsers.list.query({ page: 1, size: 50 });

  const rows = rowsRaw.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    ownerLabel:
      (r as { ownerName?: string | null }).ownerName ??
      (r as { ownerEmail?: string | null }).ownerEmail ??
      (r as { ownerId?: string }).ownerId ??
      "",
    membersCount: (r as { membersCount?: number }).membersCount ?? 0,
    isActive: (r as { isActive?: number }).isActive ?? 1,
    createdAt: new Date(
      (r as { createdAt?: number | Date }).createdAt ?? Date.now(),
    ),
  }));
  const owners = ownersRaw.map((u) => ({
    id: u.id as string,
    name: (u as { name?: string | null }).name ?? null,
    email: (u as { email?: string | null }).email ?? null,
  }));

  return (
    <EntitiesDataTable
      rows={rows}
      page={page}
      size={size}
      query={query}
      status={status}
      owners={owners}
      ownerId={ownerId}
    />
  );
}

export default function AdminEntitiesPage(props: Props) {
  return (
    <Suspense fallback={<AdminEntitiesSkeleton />}>
      <AdminEntitiesContent {...props} />
    </Suspense>
  );
}
