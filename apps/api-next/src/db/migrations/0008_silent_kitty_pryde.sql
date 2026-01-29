CREATE TABLE `workspace_user_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`filters` text,
	`display_filters` text,
	`display_properties` text,
	`rich_filters` text,
	`navigation_project_limit` integer DEFAULT 10,
	`navigation_control_preference` text DEFAULT 'ACCORDION',
	`product_tour` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_user_prop_user_workspace_idx` ON `workspace_user_properties` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_prop_unique` ON `workspace_user_properties` (`workspace_id`,`user_id`);