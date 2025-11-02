import { Suspense } from "react";
import type { Metadata } from "next/types";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./skeleton";
import { z } from "zod";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Lexidraw | Dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

const Sort = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  flex: z.enum(["flex-row", "flex-col"]).default("flex-col"),
  tags: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  onlyFavorites: z.coerce.boolean().optional().default(false),
});

type Sort = z.infer<typeof Sort>;

const CookiePrefsSchema = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  flex: z.enum(["flex-row", "flex-col"]).optional(),
  tags: z.string().optional(),
  includeArchived: z.boolean().optional(),
  onlyFavorites: z.boolean().optional(),
});

type Props = {
  searchParams: Promise<Sort>;
};

async function getFlexPreference(searchParams: Promise<Sort>) {
  const queryParams = await searchParams;
  // Default if nothing is provided anywhere
  let flex: string | undefined;
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
        const toStr = (v: unknown) => (v == null ? undefined : String(v));
        flex = hasOwn.call(q, "flex") ? toStr(q.flex) : (c.flex ?? "flex-col");
      }
    }
  } catch {
    // ignore cookie errors; we'll fall back to query/defaults
  }

  if (!flex) {
    const q = queryParams as Record<string, unknown>;
    const toStr = (v: unknown) => (v == null ? undefined : String(v));
    flex = toStr(q.flex) ?? "flex-col";
  }

  return (flex === "flex-row" ? "flex-row" : "flex-col") as
    | "flex-row"
    | "flex-col";
}

async function DashboardContent({ searchParams }: Props) {
  const queryParams = await searchParams;

  // Merge: cookie -> query -> defaults (no redirect, SSR friendly)
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
    // ignore cookie errors; we'll use defaults via Sort.parse
  }

  const query = Sort.parse(merged);
  return <Dashboard {...query} />;
}

export default async function DashboardPage(props: Props) {
  const flex = await getFlexPreference(props.searchParams);
  return (
    <Suspense fallback={<DashboardSkeleton flex={flex} />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
