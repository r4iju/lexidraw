CREATE TABLE generated_image_cleanup_cursor (
 singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
 last_attempted_id TEXT
);
--> statement-breakpoint
INSERT INTO generated_image_cleanup_cursor(singleton,last_attempted_id) VALUES(1,NULL);
--> statement-breakpoint
CREATE INDEX generated_images_cleanup ON generated_images(state,id);
