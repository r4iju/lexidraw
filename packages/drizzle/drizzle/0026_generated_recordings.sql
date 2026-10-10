CREATE TABLE `generated_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`document_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`size` integer NOT NULL,
	`state` text NOT NULL,
	`recording` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "generated_recording_size" CHECK(size BETWEEN 1 AND 62000000),
	CONSTRAINT "generated_recording_state" CHECK(state IN ('pending','registered','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_recordings_account_key` ON `generated_recordings` (`account_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `generated_recordings_account` ON `generated_recordings` (`account_id`,`state`);
--> statement-breakpoint
CREATE INDEX `generated_recordings_document` ON `generated_recordings` (`account_id`,`document_id`,`state`);
--> statement-breakpoint
CREATE INDEX `generated_recordings_expiry` ON `generated_recordings` (`state`,`expires_at`);
