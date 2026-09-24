import { createHash } from "node:crypto";

/** A password as sign-up stored it before passwords were salted. */
export const legacyPasswordHash = (password: string) =>
  createHash("sha256").update(password).digest("hex");
