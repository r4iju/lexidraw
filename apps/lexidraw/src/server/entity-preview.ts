import "server-only";
import { and, eq, isNull, type drizzle, schema } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";
import type { Metadata } from "next";
import { entityText } from "~/lib/entity-text";
import { linkPreview } from "~/lib/link-preview";

/**
 * What a pasted link to an entity shows. Chat apps fetch it signed out, so
 * only a file shared with the public describes itself; any other previews as
 * the site, without its title.
 */
export async function entityPreview(
  db: typeof drizzle,
  id: string,
): Promise<Metadata> {
  const [entity] = await db
    .select({
      title: schema.entities.title,
      entityType: schema.entities.entityType,
      elements: schema.entities.elements,
      screenShotLight: schema.entities.screenShotLight,
      publicAccess: schema.entities.publicAccess,
    })
    .from(schema.entities)
    .where(and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)))
    .limit(1);
  if (!entity || entity.publicAccess === PublicAccess.PRIVATE) return {};

  return linkPreview({
    title: entity.title,
    entityType: entity.entityType,
    text: entityText(entity.entityType, entity.elements),
    image: entity.screenShotLight || null,
  });
}
