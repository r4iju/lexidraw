-- Create LLMAuditEvents table for auditing LLM usage
CREATE TABLE IF NOT EXISTS "LLMAuditEvents" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entityId" TEXT,
  "mode" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "temperature" REAL NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "latencyMs" INTEGER NOT NULL,
  "stream" INTEGER NOT NULL,
  "toolCalls" TEXT,
  "promptLen" INTEGER,
  "messagesCount" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "httpStatus" INTEGER,
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY ("entityId") REFERENCES "Entities"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "LLMAudit_user_createdAt_idx" ON "LLMAuditEvents" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LLMAudit_entity_createdAt_idx" ON "LLMAuditEvents" ("entityId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LLMAudit_mode_createdAt_idx" ON "LLMAuditEvents" ("mode", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "LLMAudit_route_createdAt_idx" ON "LLMAuditEvents" ("route", "createdAt" DESC);

