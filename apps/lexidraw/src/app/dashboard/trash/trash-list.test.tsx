/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { EntityType } from "@packages/types";
import type { ComponentProps } from "react";
import { button, click, installDom, render } from "~/test/dom";

installDom();

/** Where the server puts each restored file back, by id. */
const restoredInto: Record<string, string | null> = {
  plan: null,
  notes: "dir-team",
};
const restored: string[] = [];
const said: string[] = [];
let revalidated = 0;

mock.module("~/trpc/react", () => ({
  api: {
    entities: {
      restore: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            { id }: { id: string },
            { onSuccess }: { onSuccess: (answer: object) => Promise<void> },
          ) => {
            restored.push(id);
            return onSuccess({ id, parentId: restoredInto[id] ?? null });
          },
        }),
      },
    },
  },
}));
mock.module("../server-actions", () => ({
  revalidateDashboard: async () => {
    revalidated += 1;
  },
}));
mock.module("sonner", () => ({
  toast: {
    success: (message: string) => said.push(message),
    error: (message: string) => said.push(message),
  },
}));
const { TrashList } = await import("./trash-list");

type Item = ComponentProps<typeof TrashList>["items"][number];

const item = (id: string, title: string): Item => ({
  id,
  title,
  entityType: EntityType.DOCUMENT,
  screenShotLight: "",
  screenShotDark: "",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  deletedAt: new Date(),
});

describe("the Trash", () => {
  test("says so when nothing is in it", async () => {
    const view = await render(<TrashList items={[]} />);
    expect(document.querySelector("h2")?.textContent).toBe(
      "The Trash is empty",
    );
    await view.unmount();
  });

  test("restores a file and says where it went back to", async () => {
    const view = await render(
      <TrashList items={[item("plan", "Plan"), item("notes", "Notes")]} />,
    );

    await click(button("Restore “Plan”"));
    await click(button("Restore “Notes”"));

    expect(restored).toEqual(["plan", "notes"]);
    expect(said).toEqual([
      "Restored “Plan” to Home.",
      "Restored “Notes” to its folder.",
    ]);
    expect(revalidated).toBe(2);
    await view.unmount();
  });
});
