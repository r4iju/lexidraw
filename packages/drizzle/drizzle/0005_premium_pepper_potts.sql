ALTER TABLE `Entities` ADD `parentId` text REFERENCES Entities(id);--> statement-breakpoint
CREATE INDEX `Entity_parentId_idx` ON `Entities` (`parentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Entity_unique_directory_name` ON `Entities` (`title`,`parentId`) WHERE entityType = 'directory';--> statement-breakpoint
ALTER TABLE `Users` ADD `config` text;