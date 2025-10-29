export const dynamic = "force-dynamic";
import { UsageDataTable } from "./data-table";
import { api } from "~/trpc/server";

export default async function AdminLlmUsagePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = Number(searchParams.page ?? 1) || 1;
  const size = Number(searchParams.size ?? 50) || 50;
  const route =
    typeof searchParams.route === "string" ? searchParams.route : undefined;
  const model =
    typeof searchParams.model === "string" ? searchParams.model : undefined;
  const sort =
    typeof searchParams.sort === "string" ? searchParams.sort : undefined; // e.g., createdAt.desc

  const rowsRaw = await api.adminLlm.usage.list.query({
    page,
    size,
    route: route && route.length > 0 ? route : undefined,
  });

  const rows = rowsRaw.map((d) => ({
    id: d.id,
    createdAt: new Date(d.createdAt),
    requestId: d.requestId,
    userId: d.userId,
    userEmail: (d as { userEmail?: string | null }).userEmail ?? null,
    entityId: d.entityId ?? null,
    mode: d.mode,
    route: d.route,
    provider: d.provider,
    modelId: d.modelId,
    totalTokens: d.totalTokens ?? null,
    latencyMs: d.latencyMs,
    errorCode: d.errorCode ?? null,
    httpStatus: d.httpStatus ?? null,
  }));

  return (
    <UsageDataTable
      rows={rows}
      page={page}
      size={size}
      routeFilter={route ?? ""}
      modelFilter={model ?? ""}
      sort={sort}
    />
  );
}
