CREATE TABLE `pro_billing_bindings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`environment` text NOT NULL,
	CONSTRAINT "sandbox_binding_environment" CHECK(environment='sandbox')
);

--> statement-breakpoint
CREATE UNIQUE INDEX `pro_billing_bindings_customer_id_unique` ON `pro_billing_bindings` (`customer_id`);
--> statement-breakpoint
CREATE TABLE `pro_lifecycle_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`created_at` integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE `pro_period_blocks` (
	`period_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `pro_periods`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `pro_subscriptions` (
	`source` text NOT NULL,
	`subscription_id` text NOT NULL,
	`account_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`state` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`cancel_at_end` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source`, `subscription_id`)
);
