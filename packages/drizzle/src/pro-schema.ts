import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const proEligibility = sqliteTable(
  "pro_eligibility",
  {
    accountId: text("account_id").primaryKey().notNull(),
    active: integer("active").notNull(),
  },
  () => [check("eligibility_active", sql`active IN (0,1)`)],
);
export const proAudit = sqliteTable("pro_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: text("actor_id").notNull(),
  accountId: text("account_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const proPeriods = sqliteTable(
  "pro_periods",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    eventId: text("event_id").notNull().unique(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    environment: text("environment").notNull(),
    pricebook: text("pricebook").notNull(),
    granted: integer("granted").notNull(),
    available: integer("available").notNull(),
    reserved: integer("reserved").notNull().default(0),
  },
  (t) => [
    uniqueIndex("pro_periods_account_start").on(t.accountId, t.startsAt),
    check("pro_period_environment", sql`environment IN ('test','sandbox')`),
    check(
      "pro_period_allowance",
      sql`granted BETWEEN 1 AND 1000000000 AND available >= 0 AND reserved >= 0 AND available + reserved <= granted`,
    ),
    check("pro_period_dates", sql`ends_at > starts_at`),
  ],
);
export const proOperations = sqliteTable(
  "pro_operations",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    periodId: text("period_id")
      .notNull()
      .references(() => proPeriods.id),
    idempotencyKey: text("idempotency_key").notNull(),
    inputHash: text("input_hash").notNull(),
    feature: text("feature").notNull(),
    state: text("state").notNull(),
    quote: integer("quote").notNull(),
    charged: integer("charged").notNull().default(0),
    pricebook: text("pricebook").notNull(),
    policy: text("policy").notNull(),
    result: text("result"),
    cancelRequested: integer("cancel_requested").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pro_operations_account_key").on(t.accountId, t.idempotencyKey),
    index("pro_operations_account_state").on(t.accountId, t.state),
    check(
      "pro_operation_state",
      sql`state IN ('reserved','running','unknown','settled','refunded','cancelled')`,
    ),
    check(
      "pro_operation_quote",
      sql`quote > 0 AND charged >= 0 AND charged <= quote`,
    ),
  ],
);
export const proReservations = sqliteTable(
  "pro_reservations",
  {
    operationId: text("operation_id")
      .primaryKey()
      .notNull()
      .references(() => proOperations.id),
    periodId: text("period_id")
      .notNull()
      .references(() => proPeriods.id),
    amount: integer("amount").notNull(),
    active: integer("active").notNull().default(1),
  },
  () => [check("pro_reservation_bound", sql`amount > 0 AND active IN (0,1)`)],
);
export const proAttempts = sqliteTable(
  "pro_attempts",
  {
    id: text("id").primaryKey().notNull(),
    operationId: text("operation_id")
      .notNull()
      .references(() => proOperations.id),
    number: integer("number").notNull(),
    chunkHash: text("chunk_hash"),
    state: text("state").notNull(),
    costNanoUsd: integer("cost_nano_usd"),
    exposureNanoUsd: integer("exposure_nano_usd").notNull(),
    usage: text("usage"),
    result: text("result"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pro_attempts_operation_number").on(t.operationId, t.number),
    uniqueIndex("pro_narration_attempt_chunk").on(t.operationId, t.chunkHash),
    index("pro_attempts_created").on(t.createdAt),
    check(
      "pro_attempt_state",
      sql`state IN ('started','completed','failed','unknown')`,
    ),
    check("pro_attempt_cost", sql`cost_nano_usd IS NULL OR cost_nano_usd >= 0`),
  ],
);
export const proLedgerEntries = sqliteTable(
  "pro_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id").notNull(),
    periodId: text("period_id")
      .notNull()
      .references(() => proPeriods.id),
    operationId: text("operation_id").references(() => proOperations.id),
    kind: text("kind").notNull(),
    subcredits: integer("subcredits").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pro_ledger_operation_kind").on(t.operationId, t.kind),
    check("pro_ledger_subcredits", sql`subcredits >= 0`),
  ],
);
export const proBillingEvents = sqliteTable(
  "pro_billing_events",
  {
    eventId: text("event_id").primaryKey().notNull(),
    source: text("source").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    periodId: text("period_id")
      .notNull()
      .references(() => proPeriods.id),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    subcredits: integer("subcredits").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  () => [
    check("pro_billing_environment", sql`environment IN ('test','sandbox')`),
  ],
);

export const generatedImages = sqliteTable(
  "generated_images",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    entityId: text("entity_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    contentHash: text("content_hash").notNull(),
    size: integer("size").notNull(),
    pathname: text("pathname").notNull().unique(),
    state: text("state").notNull(),
    url: text("url"),
    expiresAt: integer("expires_at").notNull(),
    leaseUntil: integer("lease_until").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("generated_images_account_key").on(
      t.accountId,
      t.idempotencyKey,
    ),
    index("generated_images_account").on(t.accountId, t.state),
    index("generated_images_expiry").on(t.state, t.expiresAt),
    check("generated_image_size", sql`size BETWEEN 1 AND 2097152`),
    check(
      "generated_image_state",
      sql`state IN ('pending','registered','abandoned')`,
    ),
  ],
);

export const proNarrationJobs = sqliteTable("pro_narration_jobs", {
  operationId: text("operation_id")
    .primaryKey()
    .notNull()
    .references(() => proOperations.id),
  documentId: text("document_id").notNull(),
  plan: text("plan").notNull(),
});

export const generatedRecordings = sqliteTable(
  "generated_recordings",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    documentId: text("document_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    contentHash: text("content_hash").notNull(),
    size: integer("size").notNull(),
    state: text("state").notNull(),
    recording: text("recording"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("generated_recordings_account_key").on(
      t.accountId,
      t.idempotencyKey,
    ),
    index("generated_recordings_account").on(t.accountId, t.state),
    index("generated_recordings_document").on(
      t.accountId,
      t.documentId,
      t.state,
    ),
    index("generated_recordings_expiry").on(t.state, t.expiresAt),
    check("generated_recording_size", sql`size BETWEEN 1 AND 62000000`),
    check(
      "generated_recording_state",
      sql`state IN ('pending','registered','abandoned')`,
    ),
  ],
);

export const proAgentJobs = sqliteTable("pro_agent_jobs", {
  operationId: text("operation_id")
    .primaryKey()
    .notNull()
    .references(() => proOperations.id),
  documentId: text("document_id").notNull(),
  request: text("request").notNull(),
  report: text("report").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
});
export const proAgentEdits = sqliteTable(
  "pro_agent_edits",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => proOperations.id),
    stepKey: text("step_key").notNull(),
    inputHash: text("input_hash").notNull(),
    receipt: text("receipt").notNull(),
  },
  (t) => [uniqueIndex("pro_agent_edit_identity").on(t.operationId, t.stepKey)],
);

export const proChatDocuments = sqliteTable(
  "pro_chat_documents",
  {
    operationId: text("operation_id")
      .primaryKey()
      .notNull()
      .references(() => proOperations.id),
    documentId: text("document_id").notNull(),
  },
  (t) => [index("pro_chat_documents_document").on(t.documentId)],
);
