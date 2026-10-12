import type { PowerPreference } from "@packages/types/power-preference";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  numeric,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "Users",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    config: text("config", { mode: "json" }).$type<{
      aiPower?: PowerPreference;
      llm?: {
        chat?: {
          modelId: string;
          provider: string;
          temperature: number;
          maxOutputTokens: number;
        };
        autocomplete?: {
          modelId: string;
          provider: string;
          temperature: number;
          maxOutputTokens: number;
        };
      };
      autocomplete?: {
        enabled?: boolean;
        delayMs?: number;
        provider?: "openai";
        modelId?: string;
        temperature?: number;
        maxOutputTokens?: number;
        reasoningEffort?: "minimal" | "standard" | "heavy";
        verbosity?: "low" | "medium" | "high";
      };
      audio?: {
        preferredPlaybackRate?: number;
      };
      tts?: {
        provider?: "openai" | "google" | "kokoro";
        voiceId?: string;
        speed?: number;
        format?: "mp3" | "ogg" | "wav";
        languageCode?: string;
        sampleRate?: number;
      };
      articles?: {
        languageCode?: string;
        maxChars?: number;
        keepQuotes?: boolean;
        autoGenerateAudioOnImport?: boolean;
      };
      autoSave?: {
        enabled?: boolean;
      };
      cookies?: {
        name: string;
        value: string;
      }[];
    }>(),
    email: text("email"),
    password: text("password"),
    /** When the email was last proven to belong to the user, in epoch ms. */
    emailVerified: numeric("emailVerified", { mode: "number" }),
    image: text("image"),
    isActive: integer("isActive").notNull().default(1),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("User_email_key").on(table.email),
    index("User_name_idx").on(table.name),
  ],
);
