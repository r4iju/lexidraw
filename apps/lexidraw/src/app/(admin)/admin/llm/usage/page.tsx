export const dynamic = "force-dynamic";
import { UsageDataTable } from "./data-table";
import { api } from "~/trpc/server";
import { z } from "zod";

// Allow sorting by all column headers that expose sorting in the table UI
export const AllowedSortFields = [
  "createdAt",
  "requestId",
  "user",
  "entityId",
  "mode",
  "totalTokens",
  "latencyMs",
  "route",
  "errorCode",
] as const;

export const ParamSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
  route: z.string().optional(),
  model: z.string().optional(),
  sortField: z.enum(AllowedSortFields).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type PageProps = {
  searchParams: Promise<z.infer<typeof ParamSchema>>;
};

export default async function AdminLlmUsagePage(props: PageProps) {
  const sp = await props.searchParams;
  const { page, size, route, model, sortField, sortOrder } =
    ParamSchema.parse(sp);
  const sort = `${sortField}.${sortOrder}`;

  const rowsRaw = await api.adminLlm.usage.list.query({
    page,
    size,
    route: route && route.length > 0 ? route : undefined,
    sort,
  });

  return (
    <UsageDataTable
      initialRawRows={rowsRaw}
      initialPage={page}
      initialSize={size}
      initialRoute={route ?? ""}
      initialModel={model ?? ""}
      initialSortField={sortField}
      initialSortOrder={sortOrder}
    />
  );
}
