/// <reference types="bun" />
import { beforeAll, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { entityPreview } = await import("~/server/entity-preview");

const OWNER = "epreview_owner";
const text = (value: string) =>
  JSON.stringify({
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [{ type: "text", version: 1, text: value, format: 0 }],
        },
      ],
    },
  });

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: OWNER, name: "Owner", email: "epreview@example.test" });
  const at = new Date("2026-09-01T00:00:00.000Z");
  const row = (id: string, title: string, publicAccess: PublicAccess) => ({
    id,
    title,
    elements: text("Everything we need to ship the new onboarding."),
    entityType: "document",
    userId: OWNER,
    publicAccess,
    screenShotLight: `https://blob.example/${id}-light.webp`,
    screenShotDark: `https://blob.example/${id}-dark.webp`,
    createdAt: at,
    updatedAt: at,
  });
  await db
    .insert(schema.entities)
    .values([
      row("epreview_shared", "Launch plan", PublicAccess.READ),
      row("epreview_private", "Salary review", PublicAccess.PRIVATE),
    ]);
});

test("a shared document previews with its title, text and thumbnail", async () => {
  const preview = await entityPreview(db, "epreview_shared");
  expect(preview.openGraph?.title).toBe("Launch plan");
  expect(preview.description).toBe(
    "Everything we need to ship the new onboarding.",
  );
  expect(JSON.stringify(preview.openGraph?.images)).toContain(
    "https://blob.example/epreview_shared-light.webp",
  );
});

test("a private or missing document says nothing about itself", async () => {
  for (const id of ["epreview_private", "epreview_missing"]) {
    const preview = await entityPreview(db, id);
    expect(JSON.stringify(preview)).not.toContain("Salary review");
    expect(preview.openGraph).toBeUndefined();
  }
});
