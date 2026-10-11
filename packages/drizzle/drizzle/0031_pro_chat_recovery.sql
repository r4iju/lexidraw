CREATE TABLE `pro_chat_documents` (
  `operation_id` text PRIMARY KEY NOT NULL REFERENCES `pro_operations`(`id`),
  `document_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pro_chat_documents_document` ON `pro_chat_documents` (`document_id`);
