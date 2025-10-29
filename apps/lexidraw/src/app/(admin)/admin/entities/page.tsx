export const dynamic = "force-dynamic";
import { api } from "~/trpc/server";

export default async function AdminEntitiesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = Number(searchParams.page ?? 1) || 1;
  const size = Number(searchParams.size ?? 50) || 50;
  const query =
    typeof searchParams.query === "string" ? searchParams.query : undefined;

  const rows = await api.adminEntities.list.query({ page, size, query });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Entities</h2>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-2">Title</th>
              <th className="text-left p-2">Owner</th>
              <th className="text-left p-2">Members</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{r.title}</td>
                <td className="p-2">
                  {(r as { ownerId?: string }).ownerId ?? "—"}
                </td>
                <td className="p-2">
                  {(r as { membersCount?: number }).membersCount ?? 0}
                </td>
                <td className="p-2">
                  {(r as { isActive?: number }).isActive
                    ? "Active"
                    : "Inactive"}
                </td>
                <td className="p-2">
                  {new Date(
                    (r as { createdAt?: number | Date }).createdAt ??
                      Date.now(),
                  ).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
