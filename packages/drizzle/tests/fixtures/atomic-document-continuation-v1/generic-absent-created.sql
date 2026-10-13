DROP TABLE TtsJobs;
CREATE TABLE `TtsJobs` (
  `id` text PRIMARY KEY NOT NULL,
  `entityId` text NOT NULL,
  `userId` text NOT NULL,
  `status` text NOT NULL,
  `manifestUrl` text,
  `stitchedUrl` text,
  `segmentCount` integer,
  `error` text,
  `ttsConfig` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `plannedCount` integer,
  `runId` text,
  FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX `TtsJobs_entityId_idx` ON `TtsJobs` (`entityId`);
CREATE INDEX `TtsJobs_status_idx` ON `TtsJobs` (`status`);
INSERT INTO TtsJobs VALUES ('saved-audio','conversion-doc-v1','owner','ready','https://example.invalid/manifest','https://example.invalid/audio',1,NULL,' {"keep":1.00} ',1710000000001,1710000000002,1,NULL);
