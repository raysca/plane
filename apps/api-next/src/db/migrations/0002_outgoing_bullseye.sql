CREATE TABLE `issue_description_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`description_html` text DEFAULT '<p></p>',
	`description_stripped` text,
	`description_json` text,
	`last_saved_at` integer,
	`owned_by_id` text NOT NULL,
	`created_by_id` text,
	`updated_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_desc_version_issue_idx` ON `issue_description_versions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_desc_version_project_idx` ON `issue_description_versions` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_desc_version_workspace_idx` ON `issue_description_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `intake_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` integer DEFAULT -2,
	`snoozed_till` integer,
	`duplicate_to_id` text,
	`source` text DEFAULT 'IN_APP',
	`source_email` text,
	`external_source` text,
	`external_id` text,
	`extra` text DEFAULT '{}',
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_to_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `intake_issue_intake_idx` ON `intake_issues` (`intake_id`);--> statement-breakpoint
CREATE INDEX `intake_issue_issue_idx` ON `intake_issues` (`issue_id`);--> statement-breakpoint
CREATE INDEX `intake_issue_project_idx` ON `intake_issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `intake_issue_status_idx` ON `intake_issues` (`status`);--> statement-breakpoint
CREATE TABLE `intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`is_default` integer DEFAULT false,
	`view_props` text DEFAULT '{}',
	`logo_props` text DEFAULT '{}',
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `intake_project_idx` ON `intakes` (`project_id`);--> statement-breakpoint
CREATE INDEX `intake_workspace_idx` ON `intakes` (`workspace_id`);