/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { EntityType, PublicAccess } from "@packages/types";
import type { ComponentProps } from "react";
import { installDom, render } from "~/test/dom";
import type { Entity } from "./entity-card-utils";

installDom();
mock.module("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
mock.module("./_actions/more-actions", () => ({
  MoreActions: ({ entity }: { entity: Entity }) => (
    <button type="button" aria-label={`More actions for ${entity.title}`} />
  ),
}));
const { DashboardEntities } = await import("./dashboard-entities");

type Props = ComponentProps<typeof DashboardEntities>;

const entity = (overrides: Partial<Entity>): Entity => ({
  id: "e1",
  title: "Untitled",
  entityType: EntityType.DOCUMENT,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  screenShotLight: "",
  screenShotDark: "",
  thumbnailStatus: "ready",
  thumbnailVersion: "1",
  thumbnailUpdatedAt: null,
  isOwner: true,
  publicAccess: PublicAccess.PRIVATE,
  parentId: null,
  favoritedAt: null,
  archivedAt: null,
  sharedWithCount: 0,
  tags: [],
  childCount: 0,
  ...overrides,
});

const fashion = entity({
  id: "f1",
  title: "Fashion",
  entityType: EntityType.DIRECTORY,
  childCount: 2,
});
const recipes = entity({
  id: "f2",
  title: "Recipes",
  entityType: EntityType.DIRECTORY,
  childCount: 28,
});
const proxies = entity({ id: "d1", title: "Proxies and downloading" });
const reading = entity({
  id: "u1",
  title: "Reading",
  entityType: EntityType.URL,
});

async function show(entities: Entity[], overrides: Partial<Props> = {}) {
  return render(
    <DashboardEntities
      entities={entities}
      flex="flex-row"
      sortBy="updatedAt"
      sortOrder="desc"
      {...overrides}
    />,
  );
}

const headings = () =>
  [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")].map(
    (heading) => heading.textContent,
  );

/** The group a heading names, by its accessible name. */
const group = (name: string) =>
  [...document.querySelectorAll("section")].find((section) => {
    const label = section.getAttribute("aria-labelledby");
    const named = label
      ? document.getElementById(label)?.textContent
      : section.getAttribute("aria-label");
    return named === name;
  });

/** Which of `names` a group shows, in the order it shows them. */
const shown = (section: Element | undefined, names: string[]) => {
  const text = section?.textContent ?? "";
  return names
    .filter((name) => text.includes(name))
    .sort((a, b) => text.indexOf(a) - text.indexOf(b));
};

const everyone = ["Fashion", "Recipes", "Proxies and downloading", "Reading"];

describe("Home in grid view", () => {
  test("puts folders in their own group above the files, in the order given", async () => {
    const view = await show([proxies, fashion, reading, recipes]);

    expect(headings()).toEqual(["Folders", "Files"]);
    const folders = group("Folders");
    const files = group("Files");
    expect(folders).toBeDefined();
    expect(files).toBeDefined();
    expect(
      // biome-ignore lint/style/noNonNullAssertion: asserted just above.
      folders!.compareDocumentPosition(files!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(shown(folders, everyone)).toEqual(["Fashion", "Recipes"]);
    expect(folders?.textContent).toContain("28 items");
    expect(shown(files, everyone)).toEqual([
      "Proxies and downloading",
      "Reading",
    ]);
    await view.unmount();
  });

  test("a folder card opens the folder and keeps its ⋯ menu", async () => {
    const view = await show([fashion, proxies]);
    const folders = group("Folders");
    const link = folders?.querySelector("a[href]");
    expect(link?.getAttribute("href")).toStartWith("/dashboard/f1?");
    expect(
      folders?.querySelector('[aria-label="More actions for Fashion"]'),
    ).not.toBeNull();
    expect(
      folders?.querySelector('[aria-label="Move Fashion"]'),
    ).not.toBeNull();
    await view.unmount();
  });

  test("shows no group headings when there are no folders", async () => {
    const view = await show([proxies, reading]);
    expect(headings()).toEqual([]);
    expect(group("Files")).toBeDefined();
    expect(document.body.textContent).toContain("Proxies and downloading");
    await view.unmount();
  });
});
