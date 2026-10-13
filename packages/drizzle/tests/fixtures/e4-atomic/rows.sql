INSERT INTO User VALUES ('user-atomic');
--> statement-breakpoint
INSERT INTO Drawing VALUES ('drawing-atomic','Literal title','{"opaque":"α\\tail"}','{"zoom":1}',11,22,NULL,'user-atomic','private');
--> statement-breakpoint
INSERT INTO SharedDrawing VALUES ('share-atomic','drawing-atomic','user-atomic','read',33);
