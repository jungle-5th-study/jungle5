-- D-30/TD-25: attached HTML stored gzip-compressed (site uploads up to
-- 50,000,000 bytes original / 10,000,000 bytes compressed). Additive only
-- (TSD 9.2), hand-written: drizzle-kit wants to rebuild post_html for the new
-- CHECK, which must never run on D1 (DROP TABLE cascades; see 0001). The CHECK
-- is a column constraint here; the snapshot lists it as a table constraint
-- (same meaning, so drizzle-kit sees no diff).
--
-- encoding = 'identity': UTF-8 text in post_html.html + post_html_chunks (as before).
-- encoding = 'gzip': gzip bytes in post_html_blobs (seq 0..n, at most 950,000
-- bytes each so the hex form stays under the 2,000,000-byte D1 value cap),
-- post_html.html = '' and chunk_count = 0. size is always the original size;
-- stored_size is the stored size (gzip size, or size for identity).
-- Replacing or removing a file deletes the other representation's rows in the
-- same batch (src/worker/lib/postHtml.ts); deleting a post cascades.
ALTER TABLE `post_html` ADD `encoding` text DEFAULT 'identity' NOT NULL CONSTRAINT "post_html_encoding_chk" CHECK(`encoding` IN ('identity', 'gzip'));
--> statement-breakpoint
ALTER TABLE `post_html` ADD `stored_size` integer;
--> statement-breakpoint
UPDATE `post_html` SET `stored_size` = `size`;
--> statement-breakpoint
CREATE TABLE `post_html_blobs` (
	`post_id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`post_id`, `seq`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "post_html_blobs_seq_chk" CHECK("post_html_blobs"."seq" >= 0)
);
