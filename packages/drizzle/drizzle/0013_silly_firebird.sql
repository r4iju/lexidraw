CREATE TABLE `AdminAuditEvents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`createdAt` integer NOT NULL,
	`adminUserId` text NOT NULL,
	`action` text NOT NULL,
	`targetType` text NOT NULL,
	`targetId` text NOT NULL,
	`data` text,
	FOREIGN KEY (`adminUserId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `AdminAuditEvents_createdAt_idx` ON `AdminAuditEvents` (`createdAt`);--> statement-breakpoint
CREATE INDEX `AdminAuditEvents_target_idx` ON `AdminAuditEvents` (`targetType`,`targetId`);--> statement-breakpoint
CREATE TABLE `LLMAuditEvents` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`requestId` text NOT NULL,
	`userId` text NOT NULL,
	`entityId` text,
	`mode` text NOT NULL,
	`route` text NOT NULL,
	`provider` text NOT NULL,
	`modelId` text NOT NULL,
	`temperature` real NOT NULL,
	`maxOutputTokens` integer NOT NULL,
	`promptTokens` integer,
	`completionTokens` integer,
	`totalTokens` integer,
	`latencyMs` integer NOT NULL,
	`stream` integer NOT NULL,
	`toolCalls` text,
	`promptLen` integer,
	`messagesCount` integer,
	`errorCode` text,
	`errorMessage` text,
	`httpStatus` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `LLMAudit_user_createdAt_idx` ON `LLMAuditEvents` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `LLMAudit_entity_createdAt_idx` ON `LLMAuditEvents` (`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `LLMAudit_mode_createdAt_idx` ON `LLMAuditEvents` (`mode`,`createdAt`);--> statement-breakpoint
CREATE INDEX `LLMAudit_route_createdAt_idx` ON `LLMAuditEvents` (`route`,`createdAt`);--> statement-breakpoint
CREATE TABLE `LLMPolicies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`modelId` text NOT NULL,
	`temperature` real NOT NULL,
	`maxOutputTokens` integer NOT NULL,
	`allowedModels` text NOT NULL,
	`enforcedCaps` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `LLMPolicies_mode_unique` ON `LLMPolicies` (`mode`);--> statement-breakpoint
ALTER TABLE `Entities` ADD `isActive` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `Entity_title_idx` ON `Entities` (`title`);--> statement-breakpoint
CREATE INDEX `Entity_createdAt_idx` ON `Entities` (`createdAt`);--> statement-breakpoint
ALTER TABLE `Users` ADD `isActive` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `User_name_idx` ON `Users` (`name`);