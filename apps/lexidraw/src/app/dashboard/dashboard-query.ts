import { cookies } from "next/headers";
import { z } from "zod";
import { DASHBOARD_VIEWS, type DashboardView } from "./view-filter";

const DASHBOARD_PREFS_COOKIE = "ld_dash_prefs";

const Query = z.object({
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).catch("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).catch("desc"),
  flex: z.enum(["flex-row", "flex-col"]).catch("flex-col"),
  tags: z.string().optional().catch(undefined),
  view: z.enum(DASHBOARD_VIEWS).catch("all"),
});

export type DashboardQuery = z.infer<typeof Query>;

const Prefs = z
  .object({
    sortBy: z.string(),
    sortOrder: z.string(),
    flex: z.string(),
    tags: z.string(),
    view: z.string(),
    // Written before views existed.
    onlyFavorites: z.boolean(),
  })
  .partial();

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
  let prefs: z.infer<typeof Prefs> = {};
  try {
    const raw = (await cookies()).get(DASHBOARD_PREFS_COOKIE)?.value;
    if (raw) prefs = Prefs.parse(JSON.parse(decodeURIComponent(raw)));
  } catch {
    // An unreadable cookie is the same as none.
  }
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
