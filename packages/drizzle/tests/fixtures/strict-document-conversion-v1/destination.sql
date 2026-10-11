CREATE TABLE Users (id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE Entities (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, elements TEXT NOT NULL,
 appState TEXT, entityType TEXT DEFAULT 'drawing' NOT NULL, parentId TEXT,
 screenShotLight TEXT DEFAULT '' NOT NULL, screenShotDark TEXT DEFAULT '' NOT NULL,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER,
 userId TEXT NOT NULL, publicAccess TEXT NOT NULL, isActive INTEGER DEFAULT 1 NOT NULL,
 thumbnailStatus TEXT DEFAULT 'pending', thumbnailUpdatedAt INTEGER, thumbnailVersion TEXT,
 FOREIGN KEY (parentId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX Entity_userId_idx ON Entities(userId);
CREATE INDEX Entity_parentId_idx ON Entities(parentId);
CREATE INDEX Entity_title_idx ON Entities(title);
CREATE INDEX Entity_createdAt_idx ON Entities(createdAt);
CREATE UNIQUE INDEX Entity_unique_directory_name ON Entities(title,parentId) WHERE entityType = 'directory';
CREATE TABLE SharedEntities (
 id TEXT PRIMARY KEY NOT NULL, entityId TEXT NOT NULL, userId TEXT NOT NULL,
 accessLevel TEXT NOT NULL, createdAt INTEGER DEFAULT 1735950685000 NOT NULL,
 updatedAt INTEGER DEFAULT 1735950685000 NOT NULL,
 FOREIGN KEY (entityId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
);
CREATE UNIQUE INDEX SharedEntity_entityId_userId_key ON SharedEntities(entityId,userId);
CREATE INDEX SharedEntity_userId_idx ON SharedEntities(userId);
CREATE INDEX SharedEntity_entityId_idx ON SharedEntities(entityId);
