CREATE TABLE `NativeSignInCodes` (
	`codeHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`codeChallenge` text NOT NULL,
	`redirectUri` text NOT NULL,
	`deviceName` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`usedAt` integer,
	`tokenId` text,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `NativeSignInCode_expiresAt_idx` ON `NativeSignInCodes` (`expiresAt`);
