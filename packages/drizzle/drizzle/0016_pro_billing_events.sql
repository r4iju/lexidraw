CREATE TABLE `pro_billing_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`environment` text NOT NULL,
	`account_id` text NOT NULL,
	`period_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`subcredits` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `pro_periods`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pro_billing_environment" CHECK(environment IN ('test','sandbox'))
);
--> statement-breakpoint
CREATE TRIGGER pro_billing_no_update BEFORE UPDATE ON pro_billing_events BEGIN SELECT RAISE(ABORT, 'Immutable billing event'); END;
--> statement-breakpoint
CREATE TRIGGER pro_billing_no_delete BEFORE DELETE ON pro_billing_events BEGIN SELECT RAISE(ABORT, 'Immutable billing event'); END;
