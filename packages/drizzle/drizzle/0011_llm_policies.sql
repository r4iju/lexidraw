-- Create LLMPolicies table to manage app-controlled LLM defaults and constraints
CREATE TABLE IF NOT EXISTS "LLMPolicies" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "mode" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "temperature" REAL NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "allowedModels" TEXT NOT NULL,
  "enforcedCaps" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  "updatedAt" INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "LLMPolicies_mode_unique" ON "LLMPolicies" ("mode");
