import { cookies } from "next/headers";
import { z } from "zod";
import { DASHBOARD_PREFS_COOKIE, parseDashboardPrefs } from "./dashboard-prefs";
import { DASHBOARD_VIEWS, type DashboardView } from "./view-filter";

const Query = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).catch("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).catch("desc"),
  flex: z.enum(["flex-row", "flex-col"]).catch("flex-col"),
  tags: z.string().optional().catch(undefined),
  view: z.enum(DASHBOARD_VIEWS).catch("all"),
});

export type DashboardQuery = z.infer<typeof Query>;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function legacyView(onlyFavorites: unknown): DashboardView | undefined {
  return onlyFavorites === true || onlyFavorites === "true"
    ? "favorites"
    : undefined;
}

/**
 * What Home shows: the address first, then what the reader chose last time
 * (the prefs cookie), then the defaults.
 */
export async function resolveDashboardQuery(
  params: Params,
): Promise<DashboardQuery> {
  const prefs = parseDashboardPrefs(
    (await cookies()).get(DASHBOARD_PREFS_COOKIE)?.value,
  );
  const pick = (key: keyof DashboardQuery) =>
    key in params ? first(params[key]) : prefs[key];

  return Query.parse({
    sortBy: pick("sortBy"),
    sortOrder: pick("sortOrder"),
    flex: pick("flex"),
    tags: pick("tags"),
    view:
      "view" in params
        ? first(params.view)
        : (legacyView(first(params.onlyFavorites)) ??
          prefs.view ??
          legacyView(prefs.onlyFavorites)),
  });
}
