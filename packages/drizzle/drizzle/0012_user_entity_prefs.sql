CREATE TABLE IF NOT EXISTS "UserEntityPrefs" (
  "userId" text NOT NULL REFERENCES "Users"("id") ON DELETE cascade ON UPDATE cascade,
  "entityId" text NOT NULL REFERENCES "Entities"("id") ON DELETE cascade ON UPDATE cascade,
  "favoritedAt" integer,
  "archivedAt" integer,
  "createdAt" integer NOT NULL,
  "updatedAt" integer NOT NULL,
  CONSTRAINT "UserEntityPrefs_user_entity_unique" UNIQUE ("userId","entityId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserEntityPrefs_user_entity_unique" ON "UserEntityPrefs" ("userId","entityId");
CREATE INDEX IF NOT EXISTS "UserEntityPrefs_userId_idx" ON "UserEntityPrefs" ("userId");
CREATE INDEX IF NOT EXISTS "UserEntityPrefs_entityId_idx" ON "UserEntityPrefs" ("entityId");
