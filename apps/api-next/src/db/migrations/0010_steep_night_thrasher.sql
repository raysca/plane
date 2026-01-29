PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`name` text,
	`is_folder` integer DEFAULT false,
	`sequence` real DEFAULT 65535,
	`parent_id` text,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_favorites`("id", "workspace_id", "user_id", "project_id", "entity_type", "entity_id", "name", "is_folder", "sequence", "parent_id", "sort_order", "created_at") SELECT "id", "workspace_id", "user_id", "project_id", "entity_type", "entity_id", "name", "is_folder", "sequence", "parent_id", "sort_order", "created_at" FROM `favorites`;--> statement-breakpoint
DROP TABLE `favorites`;--> statement-breakpoint
ALTER TABLE `__new_favorites` RENAME TO `favorites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `favorite_user_workspace_idx` ON `favorites` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `favorite_entity_idx` ON `favorites` (`entity_type`,`entity_id`);