CREATE TABLE `workspace_home_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`is_enabled` integer DEFAULT true,
	`config` text,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_home_pref_user_workspace_idx` ON `workspace_home_preferences` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_home_pref_unique` ON `workspace_home_preferences` (`workspace_id`,`user_id`,`key`);