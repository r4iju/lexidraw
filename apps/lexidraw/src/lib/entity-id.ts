import { z } from "zod";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Whether `id` is one a new entity may take: a canonical lowercase UUID of
 * the RFC 4122 variant, any version. Every shipped client sends one, and it
 * is one path segment as it stands, so a link to it can open nothing else.
 */
export function isEntityId(id: string) {
  return CANONICAL_UUID.test(id);
}

/**
 * The id a create accepts, as a pattern so the published API schema carries
 * it. Inputs that address an entity that already exists stay a plain string,
 * so a row stored before this contract stays reachable.
 */
export const NewEntityId = z
  .string()
  .regex(CANONICAL_UUID, "An entity id must be a lowercase UUID");
