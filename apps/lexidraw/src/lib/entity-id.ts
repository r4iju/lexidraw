import { z } from "zod";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether a new entity may take `id`: a canonical lowercase UUID. */
export function isEntityId(id: string) {
  return CANONICAL_UUID.test(id);
}

/** The id a create accepts. Ids of stored entities stay plain strings. */
export const NewEntityId = z
  .string()
  .regex(CANONICAL_UUID, "An entity id must be a lowercase UUID");
