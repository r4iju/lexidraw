"use cache: private";

import { Suspense } from "react";
import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";
import { DashboardSkeleton } from "../skeleton";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";

const SearchParams = z.object({
  parentId: z.string().optional().nullable().default(null),
  new: z.literal("true").optional(),
  flex: z.enum(["flex-row", "flex-col"]).default("flex-col"),
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  tags: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  onlyFavorites: z.coerce.boolean().optional().default(false),
});

type SearchParams = z.infer<typeof SearchParams>;

const CookiePrefsSchema = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  flex: z.enum(["flex-row", "flex-col"]).optional(),
  tags: z.string().optional(),
  includeArchived: z.boolean().optional(),
  onlyFavorites: z.boolean().optional(),
});

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<SearchParams>;
};

async function DashboardContent({ params, searchParams }: Props) {
  const directoryId = (await params).directoryId;
  const queryParams = await searchParams;

  // Merge: cookie -> query -> defaults (no redirect here, keep redirect for 'new' only)
  let merged: Record<string, unknown> = { ...queryParams };
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get("ld_dash_prefs")?.value;
    if (raw) {
      const parsedJson = JSON.parse(decodeURIComponent(raw));
      const cookieResult = CookiePrefsSchema.safeParse(parsedJson);
      if (cookieResult.success) {
        const c = cookieResult.data;
        const q = queryParams as Record<string, unknown>;
        const hasOwn = Object.prototype.hasOwnProperty;
        const toBool = (v: unknown) =>
          typeof v === "boolean" ? v : String(v) === "true";
        const toStr = (v: unknown) => (v == null ? undefined : String(v));
        merged = {
          parentId: q.parentId ?? null,
          new: q.new,
          sortBy: hasOwn.call(q, "sortBy")
            ? toStr(q.sortBy)
            : (c.sortBy ?? "updatedAt"),
          sortOrder: hasOwn.call(q, "sortOrder")
            ? toStr(q.sortOrder)
            : (c.sortOrder ?? "desc"),
          flex: hasOwn.call(q, "flex") ? toStr(q.flex) : (c.flex ?? "flex-col"),
          tags: hasOwn.call(q, "tags") ? toStr(q.tags) : c.tags,
          includeArchived: hasOwn.call(q, "includeArchived")
            ? toBool(q.includeArchived)
            : (c.includeArchived ?? false),
          onlyFavorites: hasOwn.call(q, "onlyFavorites")
            ? toBool(q.onlyFavorites)
            : (c.onlyFavorites ?? false),
        };
      }
    }
  } catch {
    // ignore cookie errors; we'll rely on Zod defaults
  }
  const {
    parentId,
    new: isNew,
    sortBy,
    sortOrder,
    flex,
    tags,
    includeArchived,
    onlyFavorites,
  } = SearchParams.parse(merged);

  if (isNew) {
    console.log("creating new directory");
    console.log({ parentId });
    await api.entities.create.mutate({
      id: directoryId,
      title: "New folder",
      elements: "{}",
      entityType: "directory",
      parentId: parentId,
    });
    return redirect(`/dashboard/${directoryId}`);
  }
  const directory = await api.entities.getMetadata.query({ id: directoryId });

  return (
    <Dashboard
      directory={directory}
      sortBy={sortBy}
      sortOrder={sortOrder}
      flex={flex}
      tags={tags}
      includeArchived={includeArchived}
      onlyFavorites={onlyFavorites}
    />
  );
}

export default async function DashboardPage(props: Props) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
