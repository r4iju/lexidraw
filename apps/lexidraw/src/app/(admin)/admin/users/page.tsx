export const dynamic = "force-dynamic";
import { api } from "~/trpc/server";
import { UsersDataTable } from "./data-table";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = Number(searchParams.page ?? 1) || 1;
  const size = Number(searchParams.size ?? 20) || 20;
  const query =
    typeof searchParams.query === "string" ? searchParams.query : undefined;

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
