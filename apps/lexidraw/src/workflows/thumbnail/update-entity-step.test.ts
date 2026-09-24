/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { updateEntityStep } = await import("./update-entity-step");

const OWNER = "thumb_owner";
const EDITED = new Date("2026-09-24T10:00:00.000Z");

describe("storing a rendered thumbnail", () => {
  test("is not a new revision of the entity", async () => {
    await db
      .insert(schema.users)
      .values({ id: OWNER, name: "Owner", email: "thumb-owner@example.test" });
    await db.insert(schema.entities).values({
      id: "thumb_doc",
      title: "Doc",
      elements: "{}",
      entityType: "document",
      userId: OWNER,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: EDITED,
      updatedAt: EDITED,
      thumbnailStatus: "pending",
      thumbnailVersion: "v1",
    });

    await updateEntityStep("thumb_doc", "light.webp", "dark.webp", "v1");

    const [row] = await db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.id, "thumb_doc"));
    // Open editors, listings, and `ifUnmodifiedSince` preconditions all read
    // updatedAt as the content's revision; a picture of it is not one.
    expect(row?.updatedAt).toEqual(EDITED);
    expect(row?.screenShotLight).toBe("light.webp");
    expect(row?.thumbnailVersion).toBe("v1");
    expect(row?.thumbnailUpdatedAt).toBeInstanceOf(Date);
  });
});
