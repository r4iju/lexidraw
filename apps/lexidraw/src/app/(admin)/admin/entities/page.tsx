export const dynamic = "force-dynamic";
import { api } from "~/trpc/server";
import { EntitiesDataTable } from "./data-table";

export default async function AdminEntitiesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = Number(searchParams.page ?? 1) || 1;
  const size = Number(searchParams.size ?? 50) || 50;
  const query =
    typeof searchParams.query === "string" ? searchParams.query : "";
  const statusRaw =
    typeof searchParams.status === "string" ? searchParams.status : "";
  const status: "active" | "inactive" | "all" =
    statusRaw === "active" || statusRaw === "inactive" ? statusRaw : "all";
  const ownerId =
    typeof searchParams.ownerId === "string" ? searchParams.ownerId : "";

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
      null ??
      (r as { ownerEmail?: string | null }).ownerEmail ??
      null ??
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
