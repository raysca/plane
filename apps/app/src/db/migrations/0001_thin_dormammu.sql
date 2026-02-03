CREATE TABLE `issue_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`subscriber_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriber_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_subscriber_issue_idx` ON `issue_subscribers` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_subscriber_user_idx` ON `issue_subscribers` (`subscriber_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_subscriber_unique` ON `issue_subscribers` (`issue_id`,`subscriber_id`);