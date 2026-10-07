-- D-30/TD-25: attached HTML up to 10,000,000 bytes. One D1 value is capped at
-- 2,000,000 bytes, so a file is stored in pieces of at most 1,900,000 UTF-8
-- bytes cut at character boundaries: piece 0 stays in post_html.html (every
-- existing row is already a complete one-piece file), pieces 1..n go here and
-- post_html.chunk_count = n. Additive only (TSD 9.2). Deleting a post deletes
-- its pieces (ON DELETE CASCADE); replacing or removing the file deletes them
-- in the same batch as post_html (src/worker/lib/postHtml.ts).
CREATE TABLE `post_html_chunks` (
	`post_id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`post_id`, `seq`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_html_chunks_seq_chk" CHECK("post_html_chunks"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE `post_html` ADD `chunk_count` integer DEFAULT 0 NOT NULL;
