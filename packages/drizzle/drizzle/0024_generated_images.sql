CREATE TABLE generated_images (
 id TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
 pathname TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('pending','registered','abandoned')),
 url TEXT,
 expires_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 UNIQUE(account_id,idempotency_key)
);
CREATE INDEX generated_images_account ON generated_images(account_id,state);
CREATE INDEX generated_images_expiry ON generated_images(state,expires_at);
