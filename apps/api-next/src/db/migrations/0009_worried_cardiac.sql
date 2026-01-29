PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stickies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`description` text,
	`description_html` text DEFAULT '<p></p>',
	`description_stripped` text,
	`description_binary` text,
	`logo_props` text,
	`color` text,
	`background_color` text,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_stickies`("id", "workspace_id", "user_id", "name", "description", "description_html", "description_stripped", "description_binary", "logo_props", "color", "background_color", "sort_order", "created_at", "updated_at") SELECT "id", "workspace_id", "user_id", "name", "description", "description_html", "description_stripped", "description_binary", "logo_props", "color", "background_color", "sort_order", "created_at", "updated_at" FROM `stickies`;--> statement-breakpoint
DROP TABLE `stickies`;--> statement-breakpoint
ALTER TABLE `__new_stickies` RENAME TO `stickies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sticky_user_workspace_idx` ON `stickies` (`user_id`,`workspace_id`);