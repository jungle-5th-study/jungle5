-- M2: store each member's guild role IDs (JSON array) at every Discord check so a
-- new study or a changed study role can recompute study_members immediately
-- (TSD 3.2). Additive only (TSD 9.2): NULL until the member's next check.
ALTER TABLE `members` ADD `discord_role_ids` text;
