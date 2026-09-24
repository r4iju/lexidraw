import type { EntityType } from "@packages/types";
import { Brush, File, Folder, Link2, type LucideIcon } from "lucide-react";

type StoredType = `${EntityType}`;

/**
 * What each stored entity type is called and drawn as wherever people see
 * it. The stored names ("directory", "url") stay in code and URLs; nothing a
 * person reads uses them.
 */
const ENTITY_TYPES: Record<
  StoredType,
  { label: string; Icon: LucideIcon; path: (id: string) => string }
> = {
  document: { label: "Document", Icon: File, path: (id) => `/documents/${id}` },
  drawing: { label: "Drawing", Icon: Brush, path: (id) => `/drawings/${id}` },
  directory: {
    label: "Folder",
    Icon: Folder,
    path: (id) => `/dashboard/${id}`,
  },
  url: { label: "Link", Icon: Link2, path: (id) => `/urls/${id}` },
};

function entityType(type: string) {
  return ENTITY_TYPES[type as StoredType] ?? ENTITY_TYPES.url;
}

export function entityTypeLabel(type: string) {
  return entityType(type).label;
}

export function EntityTypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const { Icon } = entityType(type);
  return <Icon className={className} aria-hidden="true" />;
}

/** The app path that opens an entity of `type`. */
export function entityHref(type: string, id: string) {
  return entityType(type).path(id);
}
