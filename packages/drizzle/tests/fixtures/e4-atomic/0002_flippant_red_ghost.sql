DROP TABLE `Document`;--> statement-breakpoint
DROP TABLE `SharedDocument`;--> statement-breakpoint
ALTER TABLE `Drawing` RENAME TO `Entity`;--> statement-breakpoint
ALTER TABLE `SharedDrawing` RENAME TO `SharedEntity`;--> statement-breakpoint
ALTER TABLE `WebRTCAnswer` RENAME COLUMN `drawingId` TO `entityId`;--> statement-breakpoint
ALTER TABLE `WebRTCOffer` RENAME COLUMN `drawingId` TO `entityId`;--> statement-breakpoint
ALTER TABLE `SharedEntity` RENAME COLUMN `drawingId` TO `entityId`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
DROP INDEX IF EXISTS `WebRTCAnswer_drawingId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `WebRTCOffer_drawingId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `Drawing_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `SharedDrawing_drawingId_userId_key`;--> statement-breakpoint
DROP INDEX IF EXISTS `SharedDrawing_userId_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `SharedDrawing_drawingId_idx`;--> statement-breakpoint
ALTER TABLE Entity ADD `entityType` text DEFAULT 'drawing' NOT NULL;--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_entityId_idx` ON `WebRTCAnswer` (`entityId`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_entityId_idx` ON `WebRTCOffer` (`entityId`);--> statement-breakpoint
CREATE INDEX `Entity_userId_idx` ON `Entity` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedEntity_entityId_userId_key` ON `SharedEntity` (`entityId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_userId_idx` ON `SharedEntity` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_entityId_idx` ON `SharedEntity` (`entityId`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/