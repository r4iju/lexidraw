ALTER TABLE pro_attempts ADD COLUMN chunk_hash text;
--> statement-breakpoint
CREATE UNIQUE INDEX pro_narration_attempt_chunk ON pro_attempts(operation_id, chunk_hash);
--> statement-breakpoint
CREATE TABLE pro_narration_jobs (
 operation_id text PRIMARY KEY NOT NULL REFERENCES pro_operations(id),
 document_id text NOT NULL,
 plan text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER pro_narration_jobs_immutable BEFORE UPDATE ON pro_narration_jobs BEGIN SELECT RAISE(ABORT, 'Narration plans are immutable'); END;
