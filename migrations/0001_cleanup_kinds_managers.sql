-- TD-24: one-time pre-launch cleanup (PRD D-22, D-23, D-24).
--   posts:   drop kind, recommend_reason, question_status, resolution_summary (+ their CHECKs)
--   studies: drop manager_id (FK + index), add discord_role_id (UNIQUE NOT NULL), join_guide
--
-- Hand-written; drizzle-kit's generated version was unsafe on D1 (see TSD 3.2):
--   * SQLite cannot DROP COLUMN a column used in a CHECK, an index or a foreign key,
--     so both tables are rebuilt.
--   * D1 enforces foreign keys and `PRAGMA foreign_keys=OFF` is a no-op inside the
--     migration transaction. DROP TABLE runs an implicit DELETE that fires
--     ON DELETE CASCADE / SET NULL in child tables (defer_foreign_keys does not stop
--     those actions). Dropping `posts` would wipe comments/post_tags; dropping
--     `studies` would wipe rounds/study_members (and through rounds, round comments
--     and posts.round_id).
--   * ALTER TABLE RENAME rewrites child FKs to the renamed table, so the usual
--     "__new_x + rename" pattern cannot be used either.
-- Pattern used instead: copy every affected table (studies, study_members, rounds,
-- posts, post_tags, comments) into FK-less backup tables, drop them children-first
-- (so no drop has a referencing child left and no FK action fires), recreate them
-- with the final DDL parents-first, copy the rows back, drop the backups.
-- Tables outside that set (members, categories, tags, ...) are only parents here and
-- are never dropped.
--
-- Existing studies (none in production on 2026-10-07) get a placeholder role id
-- 'unlinked:<study id>' that no Discord role matches; an admin links the real role.
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `_bak0001_studies` AS SELECT * FROM `studies`;
--> statement-breakpoint
CREATE TABLE `_bak0001_study_members` AS SELECT * FROM `study_members`;
--> statement-breakpoint
CREATE TABLE `_bak0001_rounds` AS SELECT * FROM `rounds`;
--> statement-breakpoint
CREATE TABLE `_bak0001_posts` AS SELECT * FROM `posts`;
--> statement-breakpoint
CREATE TABLE `_bak0001_post_tags` AS SELECT * FROM `post_tags`;
--> statement-breakpoint
CREATE TABLE `_bak0001_comments` AS SELECT * FROM `comments`;
--> statement-breakpoint
DROP TABLE `comments`;
--> statement-breakpoint
DROP TABLE `post_tags`;
--> statement-breakpoint
DROP TABLE `posts`;
--> statement-breakpoint
DROP TABLE `study_members`;
--> statement-breakpoint
DROP TABLE `rounds`;
--> statement-breakpoint
DROP TABLE `studies`;
--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`description` text,
	`materials` text,
	`cadence` text,
	`status` text DEFAULT 'active' NOT NULL,
	`discord_role_id` text NOT NULL,
	`join_guide` text,
	`hidden_at` integer,
	`hidden_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "studies_status_chk" CHECK("studies"."status" IN ('active', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studies_discord_role_id_unique` ON `studies` (`discord_role_id`);
--> statement-breakpoint
INSERT INTO `studies` (`id`, `name`, `goal`, `description`, `materials`, `cadence`, `status`, `discord_role_id`, `join_guide`, `hidden_at`, `hidden_by`, `version`, `created_at`, `updated_at`)
SELECT `id`, `name`, `goal`, `description`, `materials`, `cadence`, `status`, 'unlinked:' || `id`, NULL, `hidden_at`, `hidden_by`, `version`, `created_at`, `updated_at` FROM `_bak0001_studies`;
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`scope` text NOT NULL,
	`goal` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`meeting_at` integer,
	`location` text,
	`materials` text,
	`status` text DEFAULT 'active' NOT NULL,
	`info_version` integer DEFAULT 1 NOT NULL,
	`info_updated_by` text,
	`info_updated_at` integer,
	`notes_discussion` text,
	`notes_open_questions` text,
	`notes_next_actions` text,
	`notes_version` integer DEFAULT 1 NOT NULL,
	`notes_updated_by` text,
	`notes_updated_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`info_updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notes_updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rounds_status_chk" CHECK("rounds"."status" IN ('active', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_study_seq_uq` ON `rounds` (`study_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `rounds_meeting_idx` ON `rounds` (`meeting_at`);
--> statement-breakpoint
INSERT INTO `rounds` SELECT * FROM `_bak0001_rounds`;
--> statement-breakpoint
CREATE TABLE `study_members` (
	`study_id` text NOT NULL,
	`member_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`study_id`, `member_id`),
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_members_member_idx` ON `study_members` (`member_id`);
--> statement-breakpoint
INSERT INTO `study_members` (`study_id`, `member_id`, `joined_at`) SELECT `study_id`, `member_id`, `joined_at` FROM `_bak0001_study_members`;
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category_id` text NOT NULL,
	`author_id` text NOT NULL,
	`round_id` text,
	`links` text DEFAULT '[]' NOT NULL,
	`hidden_at` integer,
	`hidden_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_created_idx` ON `posts` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `posts_category_created_idx` ON `posts` (`category_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `posts_round_idx` ON `posts` (`round_id`);
--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`);
--> statement-breakpoint
INSERT INTO `posts` (`id`, `title`, `body`, `category_id`, `author_id`, `round_id`, `links`, `hidden_at`, `hidden_by`, `created_at`, `updated_at`)
SELECT `id`, `title`, `body`, `category_id`, `author_id`, `round_id`, `links`, `hidden_at`, `hidden_by`, `created_at`, `updated_at` FROM `_bak0001_posts`;
--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_tags_tag_idx` ON `post_tags` (`tag_id`);
--> statement-breakpoint
INSERT INTO `post_tags` (`post_id`, `tag_id`) SELECT `post_id`, `tag_id` FROM `_bak0001_post_tags`;
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`round_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`hidden_at` integer,
	`hidden_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comments_one_parent_chk" CHECK(("comments"."post_id" IS NULL) <> ("comments"."round_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `comments_post_idx` ON `comments` (`post_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `comments_round_idx` ON `comments` (`round_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `comments` (`id`, `post_id`, `round_id`, `author_id`, `body`, `hidden_at`, `hidden_by`, `created_at`, `updated_at`)
SELECT `id`, `post_id`, `round_id`, `author_id`, `body`, `hidden_at`, `hidden_by`, `created_at`, `updated_at` FROM `_bak0001_comments`;
--> statement-breakpoint
DROP TABLE `_bak0001_studies`;
--> statement-breakpoint
DROP TABLE `_bak0001_study_members`;
--> statement-breakpoint
DROP TABLE `_bak0001_rounds`;
--> statement-breakpoint
DROP TABLE `_bak0001_posts`;
--> statement-breakpoint
DROP TABLE `_bak0001_post_tags`;
--> statement-breakpoint
DROP TABLE `_bak0001_comments`;
