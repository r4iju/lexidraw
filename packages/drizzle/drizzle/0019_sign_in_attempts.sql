CREATE TABLE `SignInAttempts` (
	`key` text PRIMARY KEY NOT NULL,
	`windowStart` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `SignInAttempt_windowStart_idx` ON `SignInAttempts` (`windowStart`);
