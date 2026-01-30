-- Drop old file_assets table (no data exists)
DROP TABLE IF EXISTS `file_assets`;

-- Recreate file_assets matching Django FileAsset model
CREATE TABLE `file_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`attributes` text,
	`asset` text NOT NULL,
	`size` real DEFAULT 0,
	`user_id` text,
	`workspace_id` text,
	`project_id` text,
	`entity_type` text,
	`entity_identifier` text,
	`is_uploaded` integer DEFAULT false,
	`storage_metadata` text,
	`is_deleted` integer DEFAULT false,
	`deleted_at` integer,
	`external_id` text,
	`external_source` text,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `file_asset_workspace_idx` ON `file_assets` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `file_asset_entity_idx` ON `file_assets` (`entity_type`,`entity_identifier`);
--> statement-breakpoint
CREATE INDEX `file_asset_uploaded_by_idx` ON `file_assets` (`created_by_id`);
--> statement-breakpoint
CREATE INDEX `file_asset_asset_idx` ON `file_assets` (`asset`);
