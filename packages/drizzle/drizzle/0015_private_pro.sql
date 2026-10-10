CREATE TABLE `pro_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`number` integer NOT NULL,
	`state` text NOT NULL,
	`cost_nano_usd` integer,
	`exposure_nano_usd` integer NOT NULL,
	`usage` text,
	`result` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `pro_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pro_attempt_state" CHECK(state IN ('started','completed','failed','unknown')),
	CONSTRAINT "pro_attempt_cost" CHECK(cost_nano_usd IS NULL OR cost_nano_usd >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_attempts_operation_number` ON `pro_attempts` (`operation_id`,`number`);
--> statement-breakpoint
CREATE INDEX `pro_attempts_created` ON `pro_attempts` (`created_at`);
--> statement-breakpoint
CREATE TABLE `pro_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text NOT NULL,
	`account_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pro_eligibility` (
	`account_id` text PRIMARY KEY NOT NULL,
	`active` integer NOT NULL,
	CONSTRAINT "eligibility_active" CHECK(active IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `pro_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`period_id` text NOT NULL,
	`operation_id` text,
	`kind` text NOT NULL,
	`subcredits` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `pro_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `pro_operations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pro_ledger_subcredits" CHECK(subcredits >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_ledger_operation_kind` ON `pro_ledger` (`operation_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `pro_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`period_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`feature` text NOT NULL,
	`state` text NOT NULL,
	`quote` integer NOT NULL,
	`charged` integer DEFAULT 0 NOT NULL,
	`pricebook` text NOT NULL,
	`policy` text NOT NULL,
	`result` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `pro_periods`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pro_operation_state" CHECK(state IN ('reserved','running','unknown','settled','refunded','cancelled')),
	CONSTRAINT "pro_operation_quote" CHECK(quote > 0 AND charged >= 0 AND charged <= quote)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_operations_account_key` ON `pro_operations` (`account_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `pro_operations_account_state` ON `pro_operations` (`account_id`,`state`);
--> statement-breakpoint
CREATE TABLE `pro_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`event_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`environment` text NOT NULL,
	`pricebook` text NOT NULL,
	`granted` integer NOT NULL,
	`available` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pro_period_environment" CHECK(environment IN ('test','sandbox')),
	CONSTRAINT "pro_period_allowance" CHECK(granted BETWEEN 1 AND 1000000000 AND available >= 0 AND reserved >= 0 AND available + reserved <= granted),
	CONSTRAINT "pro_period_dates" CHECK(ends_at > starts_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_periods_event_id_unique` ON `pro_periods` (`event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_periods_account_start` ON `pro_periods` (`account_id`,`starts_at`);
--> statement-breakpoint
CREATE TABLE `pro_reservations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`amount` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `pro_operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `pro_periods`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pro_reservation_bound" CHECK(amount > 0 AND active IN (0,1))
);
--> statement-breakpoint
CREATE TRIGGER pro_ledger_no_update BEFORE UPDATE ON pro_ledger BEGIN SELECT RAISE(ABORT, 'Immutable Pro ledger'); END;
--> statement-breakpoint
CREATE TRIGGER pro_ledger_no_delete BEFORE DELETE ON pro_ledger BEGIN SELECT RAISE(ABORT, 'Immutable Pro ledger'); END;
--> statement-breakpoint
CREATE TRIGGER pro_audit_no_update BEFORE UPDATE ON pro_audit BEGIN SELECT RAISE(ABORT, 'Immutable Pro audit'); END;
--> statement-breakpoint
CREATE TRIGGER pro_audit_no_delete BEFORE DELETE ON pro_audit BEGIN SELECT RAISE(ABORT, 'Immutable Pro audit'); END;
