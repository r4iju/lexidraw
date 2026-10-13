CREATE TABLE `pro_agent_edits` (
	`operation_id` text NOT NULL,
	`step_key` text NOT NULL,
	`input_hash` text NOT NULL,
	`receipt` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `pro_operations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `pro_agent_edit_identity` ON `pro_agent_edits` (`operation_id`,`step_key`);
--> statement-breakpoint
CREATE TABLE `pro_agent_jobs` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`request` text NOT NULL,
	`report` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `pro_operations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER pro_agent_request_immutable BEFORE UPDATE OF request, document_id ON pro_agent_jobs BEGIN SELECT RAISE(ABORT, 'Agent request is immutable'); END;
