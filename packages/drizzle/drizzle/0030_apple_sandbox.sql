CREATE TABLE `pro_apple_accounts` (
  `account_id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pro_apple_accounts_token_unique` ON `pro_apple_accounts` (`token`);
--> statement-breakpoint
CREATE TRIGGER pro_apple_accounts_immutable_update BEFORE UPDATE ON pro_apple_accounts BEGIN SELECT RAISE(ABORT, 'immutable Apple account binding'); END;
--> statement-breakpoint
CREATE TRIGGER pro_apple_accounts_immutable_delete BEFORE DELETE ON pro_apple_accounts BEGIN SELECT RAISE(ABORT, 'immutable Apple account binding'); END;
--> statement-breakpoint
CREATE TABLE `pro_lifecycle_fences` (
  `source` text NOT NULL,
  `subscription_id` text NOT NULL,
  `account_id` text NOT NULL,
  `starts_at` integer NOT NULL,
  `ends_at` integer NOT NULL,
  PRIMARY KEY (`source`, `subscription_id`, `starts_at`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO pro_lifecycle_fences SELECT source,subscription_id,account_id,starts_at,ends_at FROM pro_subscriptions WHERE revoked=1;
--> statement-breakpoint
CREATE TRIGGER pro_lifecycle_fences_immutable_update BEFORE UPDATE ON pro_lifecycle_fences BEGIN SELECT RAISE(ABORT, 'immutable paid period fence'); END;
--> statement-breakpoint
CREATE TRIGGER pro_lifecycle_fences_immutable_delete BEFORE DELETE ON pro_lifecycle_fences BEGIN SELECT RAISE(ABORT, 'immutable paid period fence'); END;
