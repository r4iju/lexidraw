import type { Client } from '@libsql/client';
export const checkpoint = {
  hash: "78ab410710c6ad4e7969c31273fccb3e8f226c2fa8ad7ad94b7e20c0b7e6c54c",
  created_at: 1761866938152,
};

export const documentElements =
  '{"blocks":[{"id":"paragraph-one","text":"Keep this unrelated content"}],"tts":{"id":"saved-audio","provider":"openai","voiceId":"nova","format":"mp3","segments":[{"index":0,"text":"Synthetic narration","audioUrl":"https://storage.test/tts/segment-0.mp3","sectionTitle":"Start","sectionIndex":0,"headingDepth":1,"sectionId":"section-one"}],"manifestUrl":"https://storage.test/tts/manifest.json","stitchedUrl":"https://storage.test/tts/stitched.mp3","updatedAt":"2025-10-30T12:34:56.789Z"},"futurePayload":{"retain":true}}';

export const drawingElements =
  '[{"id":"shape-one","type":"rectangle","x":12,"y":34,"customData":{"retain":"literal"}}]';

export const job = [
  "saved-audio",
  "document-one",
  "owner",
  "ready",
  "https://storage.test/tts/manifest.json",
  "https://storage.test/tts/stitched.mp3",
  1,
  null,
  '{"provider":"openai","voiceId":"nova","format":"mp3","future":{"retain":true}}',
  1761827696000,
  1761827696789,
  1,
  "run-synthetic",
];

export const completeGenericTts = `CREATE TABLE TtsJobs (
 id text PRIMARY KEY NOT NULL, entityId text NOT NULL, userId text NOT NULL,
 status text NOT NULL, manifestUrl text, stitchedUrl text, segmentCount integer,
 error text, ttsConfig text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
 plannedCount integer, runId text,
 FOREIGN KEY (entityId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId);
--> statement-breakpoint
CREATE INDEX TtsJobs_status_idx ON TtsJobs(status);`;

export async function seedRows(client: Client) {
    await client.execute(
      "INSERT INTO Users (id,name,config,email,createdAt,updatedAt,deletedAt) VALUES ('owner','Synthetic owner','{\"retain\":true}','owner@example.test',1761800000000,1761800000123,NULL),('reader','Synthetic reader',NULL,'reader@example.test',1761800000001,1761800000456,1761800000789)",
    );
    await client.execute({
      sql: "INSERT INTO Entities (id,title,elements,appState,entityType,parentId,createdAt,updatedAt,deletedAt,userId,publicAccess,screenShotLight,screenShotDark) VALUES ('document-one','Synthetic document',?,NULL,'document',NULL,1761810000000,1761827696789,NULL,'owner','private','https://storage.test/light.png','https://storage.test/dark.png'),('drawing-one','Synthetic drawing',?,?,'drawing','document-one',1761810000123,1761810000456,1761810000789,'owner','view','','')",
      args: [
        documentElements,
        drawingElements,
        '{"viewBackgroundColor":"#ffffff","retain":42}',
      ],
    });
    await client.execute(
      "INSERT INTO SharedEntities (id,entityId,userId,accessLevel,createdAt,updatedAt) VALUES ('share-document','document-one','reader','view',1761811000000,1761811000123),('share-drawing','drawing-one','reader','edit',1761811000456,1761811000789)",
    );
    await client.execute(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    await client.execute({
      sql: "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
      args: [checkpoint.hash, checkpoint.created_at],
    });

for (const sql of completeGenericTts.split('--> statement-breakpoint')) await client.executeMultiple(sql);
await client.execute({sql:'INSERT INTO TtsJobs (id,entityId,userId,status,manifestUrl,stitchedUrl,segmentCount,error,ttsConfig,createdAt,updatedAt,plannedCount,runId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',args:job});
}
