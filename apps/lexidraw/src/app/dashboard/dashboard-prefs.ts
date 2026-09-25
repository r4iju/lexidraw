import { z } from "zod";

/** What Home was last set to show, kept so a later visit opens the same. */
export const DASHBOARD_PREFS_COOKIE = "ld_dash_prefs";

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

export type DashboardPrefs = z.infer<typeof Prefs>;

/** The prefs cookie's value; one that cannot be read is the same as none. */
export function parseDashboardPrefs(value: string | undefined): DashboardPrefs {
  if (!value) return {};
  try {
    return Prefs.catch({}).parse(JSON.parse(decodeURIComponent(value)));
  } catch {
    return {};
  }
}

/** The prefs among a browser's cookies, as `document.cookie` lists them. */
export function readDashboardPrefs(cookies: string): DashboardPrefs {
  const name = `${DASHBOARD_PREFS_COOKIE}=`;
  return parseDashboardPrefs(
    cookies
      .split("; ")
      .find((row) => row.startsWith(name))
      ?.slice(name.length),
  );
}
