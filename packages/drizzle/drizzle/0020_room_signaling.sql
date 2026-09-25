CREATE TABLE `RoomPeers` (
	`entityId` text NOT NULL,
	`peer` text NOT NULL,
	`canEdit` integer NOT NULL,
	`lastSeen` integer NOT NULL,
	PRIMARY KEY(`entityId`, `peer`),
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `RoomPeer_lastSeen_idx` ON `RoomPeers` (`lastSeen`);
--> statement-breakpoint
CREATE TABLE `RoomSignals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entityId` text NOT NULL,
	`fromPeer` text NOT NULL,
	`toPeer` text,
	`type` text NOT NULL,
	`payload` text,
	`canEdit` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `RoomSignal_entityId_id_idx` ON `RoomSignals` (`entityId`,`id`);
--> statement-breakpoint
CREATE INDEX `RoomSignal_createdAt_idx` ON `RoomSignals` (`createdAt`);
