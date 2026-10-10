import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const deviceAgentEdits = sqliteTable(
  "device_agent_edits",
  {
    accountId: text("account_id").notNull(),
    documentId: text("document_id").notNull(),
    key: text("step_key").notNull(),
    inputHash: text("input_hash").notNull(),
    receipt: text("receipt").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.key] })],
);
