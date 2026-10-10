import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { proPeriods } from "./pro-schema.js";
export const proBillingBindings = sqliteTable(
  "pro_billing_bindings",
  {
    accountId: text("account_id").primaryKey().notNull(),
    customerId: text("customer_id").unique().notNull(),
    environment: text("environment").notNull(),
  },
  () => [check("sandbox_binding_environment", sql`environment='sandbox'`)],
);
export const proSubscriptions = sqliteTable(
  "pro_subscriptions",
  {
    source: text("source").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id").notNull(),
    state: text("state").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    cancelAtEnd: integer("cancel_at_end").notNull(),
    revoked: integer("revoked").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.source, t.subscriptionId] })],
);
export const proLifecycleEvents = sqliteTable("pro_lifecycle_events", {
  eventId: text("event_id").primaryKey().notNull(),
  accountId: text("account_id").notNull(),
  subscriptionId: text("subscription_id").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const proPeriodBlocks = sqliteTable("pro_period_blocks", {
  periodId: text("period_id")
    .primaryKey()
    .notNull()
    .references(() => proPeriods.id),
  reason: text("reason").notNull(),
});
