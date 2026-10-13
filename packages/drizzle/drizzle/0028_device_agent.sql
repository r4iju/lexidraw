CREATE TABLE `device_agent_edits` (
 `account_id` text NOT NULL,
 `document_id` text NOT NULL,
 `step_key` text NOT NULL,
 `input_hash` text NOT NULL,
 `receipt` text NOT NULL,
 `created_at` integer NOT NULL,
 PRIMARY KEY(`account_id`, `step_key`)
);
