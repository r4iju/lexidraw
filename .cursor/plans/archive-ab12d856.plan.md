<!-- ab12d856-c3d5-44e4-83dc-7950457c10dc beaeb006-9262-45e0-b154-13d99d270fc7 -->
# Implement per-user Archive and Favorite with Dashboard Filters

### Goals

- Per-user archive/favorite, using timestamps (`archivedAt`, `favoritedAt`).
- Default folder views exclude archived; search still includes archived.
- Dashboard header filter (query param `view`): `all` | `favorites` | `archived`.
- Items remain in their folders (`parentId` unchanged).

### Database

- Add `UserEntityPrefs` table (unique per `[userId, entityId]`).
```sql
CREATE TABLE "UserEntityPrefs" (
  "userId" text NOT NULL REFERENCES "Users"("id") ON DELETE cascade ON UPDATE cascade,
  "entityId" text NOT NULL REFERENCES "Entities"("id") ON DELETE cascade ON UPDATE cascade,
  "favoritedAt" integer,
  "archivedAt" integer,
  "createdAt" integer NOT NULL,
  "updatedAt" integer NOT NULL,
  CONSTRAINT "UserEntityPrefs_user_entity_unique" UNIQUE ("userId","entityId")
);
CREATE INDEX "UserEntityPrefs_userId_idx" ON "UserEntityPrefs" ("userId");
CREATE INDEX "UserEntityPrefs_entityId_idx" ON "UserEntityPrefs" ("entityId");
```

- Schema: `packages/drizzle/src/drizzle-schema.ts` add `userEntityPrefs` with the above columns and unique index.

### API (tRPC)

- Extend list input to include `view` with default `all`.
```ts
z.object({
  parentId: z.string().nullable(),
  tagNames: z.array(z.string()).optional(),
  sortBy: z.enum(["updatedAt","createdAt","title"]).optional().default("updatedAt"),
  sortOrder: z.enum(["asc","desc"]).optional().default("desc"),
  view: z.enum(["all","favorites","archived"]).optional().default("all"),
})
```

- Modify list query to left-join `userEntityPrefs` by current user and filter by `view`:
  - `all`: `isNull(entities.deletedAt)` AND `isNull(userEntityPrefs.archivedAt)`
  - `favorites`: `isNull(entities.deletedAt)` AND `not isNull(userEntityPrefs.favoritedAt)`
  - `archived`: `isNull(entities.deletedAt)` AND `not isNull(userEntityPrefs.archivedAt)`
- Select and return `favoritedAt` and `archivedAt` for UI.
- Add mutation `updateUserPrefs`:
```ts
.input(z.object({ entityId: z.string(), favorite: z.boolean().optional(), archive: z.boolean().optional() }))
.mutation(({ ctx, input }) => {
  // upsert prefs row for (userId, entityId), set favoritedAt/archivedAt to now or null; update updatedAt
})
```

- Keep search endpoints unchanged so archived remain searchable.

### Dashboard UI

- Parse `view` from search params with default `all` in:
  - `apps/lexidraw/src/app/dashboard/page.tsx`
  - `apps/lexidraw/src/app/dashboard/[directoryId]/page.tsx`
- Pass `view` to `Dashboard` props and into `api.entities.list.query`.
```12:43:apps/lexidraw/src/app/dashboard/dashboard.tsx
const entities = await api.entities.list.query({
  parentId: directory ? directory.id : null,
  sortBy,
  sortOrder,
  tagNames: tags ? tags.split(",").filter(Boolean) : [],
  // + view
});
```

- Add a header filter control next to existing buttons: three buttons/toggle for `All | Favorites | Archived` that update the `view` query param using the existing `replaceSearchParam` helper.

### Item Actions UI

- In `apps/lexidraw/src/app/dashboard/_actions/more-actions.tsx`:
  - Add menu items to toggle Favorite/Unfavorite and Archive/Unarchive.
  - Call `api.entities.updateUserPrefs.useMutation()`; on success, invalidate all `entities.list` queries (no key) and revalidate dashboard.
- Optionally, show a small favorite star toggle in `entity-card.tsx` and a subtle "Archived" badge if `archivedAt` is set in non-archived views.

### Invalidations and Optimism

- For simplicity and correctness, prefer `utils.entities.list.invalidate()` without a key in these new mutations to cover all `view/parentId` combinations.
- Leave existing drag/share optimistic updates as-is; they remain compatible.

### Notes

- Search and deepSearch deliberately do not filter out archived; they’ll return archived results. We may show an "Archived" badge in search UI later if desired.
- No changes to `parentId` logic; items stay in their folders.

### To-dos

- [ ] Add UserEntityPrefs table and migration with indexes/unique
- [ ] Define userEntityPrefs in drizzle-schema.ts
- [ ] Extend list input with view; join prefs; return timestamps
- [ ] Add updateUserPrefs mutation (toggle favorite/archive)
- [ ] Parse and forward view in dashboard pages and component
- [ ] Add All/Favorites/Archived header filter using query param
- [ ] Add Favorite/Archive toggles in MoreActions; invalidate list
- [ ] Optional star toggle and Archived badge on EntityCard