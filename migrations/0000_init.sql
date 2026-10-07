CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_member_idx` ON `auth_sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`archived_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_key_unique` ON `categories` (`name_key`);--> statement-breakpoint
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
CREATE INDEX `comments_post_idx` ON `comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_round_idx` ON `comments` (`round_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `discord_tokens` (
	`member_id` text PRIMARY KEY NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text,
	`display_name` text,
	`avatar_url` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_guild_member` integer DEFAULT true NOT NULL,
	`verified_at` integer NOT NULL,
	`withdrawn_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_discord_user_id_unique` ON `members` (`discord_user_id`);--> statement-breakpoint
CREATE TABLE `ops_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_tags_tag_idx` ON `post_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category_id` text NOT NULL,
	`author_id` text NOT NULL,
	`round_id` text,
	`links` text DEFAULT '[]' NOT NULL,
	`recommend_reason` text,
	`question_status` text,
	`resolution_summary` text,
	`hidden_at` integer,
	`hidden_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posts_kind_chk" CHECK("posts"."kind" IN ('note', 'resource', 'question')),
	CONSTRAINT "posts_question_status_chk" CHECK(("posts"."kind" = 'question' AND "posts"."question_status" IN ('open', 'resolved')) OR ("posts"."kind" <> 'question' AND "posts"."question_status" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `posts_created_idx` ON `posts` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `posts_category_created_idx` ON `posts` (`category_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `posts_round_idx` ON `posts` (`round_id`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `rounds_study_seq_uq` ON `rounds` (`study_id`,`seq`);--> statement-breakpoint
CREATE INDEX `rounds_meeting_idx` ON `rounds` (`meeting_at`);--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`description` text,
	`materials` text,
	`cadence` text,
	`status` text DEFAULT 'active' NOT NULL,
	`manager_id` text NOT NULL,
	`hidden_at` integer,
	`hidden_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hidden_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "studies_status_chk" CHECK("studies"."status" IN ('active', 'ended'))
);
--> statement-breakpoint
CREATE INDEX `studies_manager_idx` ON `studies` (`manager_id`);--> statement-breakpoint
CREATE TABLE `study_members` (
	`study_id` text NOT NULL,
	`member_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`study_id`, `member_id`),
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_members_member_idx` ON `study_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_key_unique` ON `tags` (`name_key`);--> statement-breakpoint
-- Seed (PRD F-02): the only default category. Hand-added; not part of the drizzle snapshot.
INSERT INTO `categories` (`id`, `name`, `name_key`, `archived_at`, `created_by`, `created_at`) VALUES ('01900000-0000-7000-8000-000000000001', '기타', '기타', NULL, NULL, 1791331200000);
