import { Drag } from "./drag";
import { Drop } from "./drop";
import { EntityCardCol } from "./entity-card-col";
import { EntityCardRow } from "./entity-card-row";
import type { Entity } from "./entity-card-utils";
import { FolderCard } from "./folder-card";

type Props = {
  entities: Entity[];
  flex: "flex-row" | "flex-col";
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
};

const GRID = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4";

/**
 * What's in Home or a folder, folders first. In the grid they are their own
 * group of compact tiles, since a folder has no picture to fill a file's card.
 */
export function DashboardEntities({
  entities,
  flex,
  sortBy,
  sortOrder,
}: Props) {
  const folders = entities.filter(
    (entity) => entity.entityType === "directory",
  );
  const files = entities.filter((entity) => entity.entityType !== "directory");
  const item = (entity: Entity) => (
    <Drag entity={entity} key={entity.id}>
      <Drop parentId={entity.id} disabled={entity.entityType !== "directory"}>
        {flex === "flex-col" ? (
          <EntityCardCol
            entity={entity}
            flex={flex}
            sortBy={sortBy}
            sortOrder={sortOrder}
          />
        ) : entity.entityType === "directory" ? (
          <FolderCard entity={entity} sortBy={sortBy} sortOrder={sortOrder} />
        ) : (
          <EntityCardRow
            entity={entity}
            flex={flex}
            sortBy={sortBy}
            sortOrder={sortOrder}
          />
        )}
      </Drop>
    </Drag>
  );

  if (flex === "flex-col") {
    return (
      <section
        aria-label="Files"
        className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card"
      >
        {folders.map(item)}
        {files.map(item)}
      </section>
    );
  }

  if (folders.length === 0) {
    return (
      <section aria-label="Files" className={GRID}>
        {files.map(item)}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Group id="dashboard-folders" title="Folders">
        {folders.map(item)}
      </Group>
      {files.length > 0 && (
        <Group id="dashboard-files" title="Files">
          {files.map(item)}
        </Group>
      )}
    </div>
  );
}

function Group({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="pl-1 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      <div className={GRID}>{children}</div>
    </section>
  );
}
