-- D-30/TD-25: one attached HTML file per post, in its own table so post lists never
-- read the large value. Additive only (TSD 9.2). Deleting a post deletes its HTML
-- (ON DELETE CASCADE). discord_message_id makes the Discord message command
-- idempotent (D-32, TD-27). No extracted-text column: HTML is not searchable (TSD 3.2).
CREATE TABLE `post_html` (
	`post_id` text PRIMARY KEY NOT NULL,
	`html` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_at` integer NOT NULL,
	`uploaded_via` text NOT NULL,
	`discord_message_id` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_html_uploaded_via_chk" CHECK("post_html"."uploaded_via" IN ('site', 'discord'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_html_discord_message_id_unique` ON `post_html` (`discord_message_id`);