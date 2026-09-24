/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { authorizeCredentials } = await import("./credentials");
const { hashPassword } = await import("./password");

const PASSWORD = "Correct-Horse-Battery-9!";

async function seedUser(id: string, password: string) {
  const email = `${id}@example.test`;
  await db.insert(schema.users).values({ id, name: id, email, password });
  return email;
}

async function storedPassword(id: string) {
  const [row] = await db
    .select({ password: schema.users.password })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return row?.password;
}

describe("credentials sign-in", () => {
  test("a legacy SHA-256 user signs in and is moved to scrypt", async () => {
    const legacy = createHash("sha256").update(PASSWORD).digest("hex");
    const email = await seedUser("cred_legacy", legacy);

    const user = await authorizeCredentials(email, PASSWORD);

    expect(user?.id).toBe("cred_legacy");
    expect(user).not.toHaveProperty("password");
    const upgraded = await storedPassword("cred_legacy");
    expect(upgraded).toStartWith("scrypt$");
    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_legacy",
    );
  });

  test("a wrong password is refused and leaves the stored hash alone", async () => {
    const legacy = createHash("sha256").update(PASSWORD).digest("hex");
    const email = await seedUser("cred_wrong", legacy);

    expect(await authorizeCredentials(email, `${PASSWORD}x`)).toBeNull();
    expect(await storedPassword("cred_wrong")).toBe(legacy);
  });

  test("a current scrypt hash is not rewritten on sign-in", async () => {
    const current = await hashPassword(PASSWORD);
    const email = await seedUser("cred_current", current);

    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_current",
    );
    expect(await storedPassword("cred_current")).toBe(current);
  });
});
