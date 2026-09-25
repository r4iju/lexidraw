import { describe, expect, test } from "bun:test";
import { DASHBOARD_PREFS_COOKIE, readDashboardPrefs } from "./dashboard-prefs";

const cookie = (prefs: unknown) =>
  `theme=dark; ${DASHBOARD_PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; other=1`;

describe("Home's remembered choices", () => {
  test("are read from among a browser's other cookies", () => {
    expect(
      readDashboardPrefs(cookie({ flex: "flex-row", sortBy: "title" })),
    ).toEqual({ flex: "flex-row", sortBy: "title" });
  });

  test("are none when the cookie is missing or unreadable", () => {
    expect(readDashboardPrefs("theme=dark")).toEqual({});
    expect(readDashboardPrefs(`${DASHBOARD_PREFS_COOKIE}=%7Bnot-json`)).toEqual(
      {},
    );
    expect(readDashboardPrefs(cookie({ flex: 3 }))).toEqual({});
  });
});
