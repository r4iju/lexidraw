CREATE TABLE `ApiTokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`scope` text NOT NULL,
	`expiresAt` integer,
	`lastUsedAt` integer,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ApiToken_tokenHash_unique` ON `ApiTokens` (`tokenHash`);
--> statement-breakpoint
CREATE INDEX `ApiToken_userId_idx` ON `ApiTokens` (`userId`);
