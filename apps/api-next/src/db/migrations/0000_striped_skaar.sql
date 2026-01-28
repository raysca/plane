CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_provider_idx` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_token_user_id_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_token_hash_idx` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_token_idx` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`timezone` text DEFAULT 'UTC',
	`date_format` text DEFAULT 'MM/DD/YYYY',
	`time_format` text DEFAULT '12h',
	`theme` text DEFAULT 'system',
	`language` text DEFAULT 'en',
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_user_id_unique` ON `user_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false,
	`name` text,
	`image` text,
	`username` text,
	`display_name` text,
	`avatar` text,
	`cover_image` text,
	`first_name` text,
	`last_name` text,
	`is_onboarded` integer DEFAULT false,
	`is_active` integer DEFAULT true,
	`is_tour_completed` integer DEFAULT false,
	`onboarding_step` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `user_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `user_username_idx` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `favorite_user_workspace_idx` ON `favorites` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `favorite_entity_idx` ON `favorites` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `quick_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quick_link_user_workspace_idx` ON `quick_links` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `recent_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`visited_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recent_visit_user_workspace_idx` ON `recent_visits` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `stickies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`description` text,
	`color` text DEFAULT '#FEF3C7',
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sticky_user_workspace_idx` ON `stickies` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`token` text NOT NULL,
	`message` text,
	`responded_at` integer,
	`accepted` integer,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invitations_token_unique` ON `workspace_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `workspace_invitation_workspace_idx` ON `workspace_invitations` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_invitation_token_idx` ON `workspace_invitations` (`token`);--> statement-breakpoint
CREATE TABLE `workspace_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#000000' NOT NULL,
	`description` text,
	`sort_order` real DEFAULT 65535,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_label_workspace_idx` ON `workspace_labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`is_active` integer DEFAULT true,
	`view_props` text,
	`default_props` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_member_workspace_idx` ON `workspace_members` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_member_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_member_unique` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`owner_id` text NOT NULL,
	`organization_size` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `workspace_slug_idx` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `workspace_owner_idx` ON `workspaces` (`owner_id`);--> statement-breakpoint
CREATE TABLE `estimate_points` (
	`id` text PRIMARY KEY NOT NULL,
	`estimate_id` text NOT NULL,
	`key` integer NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `estimate_point_estimate_idx` ON `estimate_points` (`estimate_id`);--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'categories',
	`last_used_at` integer,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `estimate_project_idx` ON `estimates` (`project_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`color` text DEFAULT '#000000' NOT NULL,
	`description` text,
	`sort_order` real DEFAULT 65535,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `label_project_idx` ON `labels` (`project_id`);--> statement-breakpoint
CREATE INDEX `label_workspace_idx` ON `labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` integer DEFAULT 15 NOT NULL,
	`is_active` integer DEFAULT true,
	`view_props` text,
	`default_props` text,
	`preferences` text,
	`sort_order` real DEFAULT 65535,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_member_project_idx` ON `project_members` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_member_member_idx` ON `project_members` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_member_unique` ON `project_members` (`project_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`description_text` text,
	`description_html` text,
	`network` integer DEFAULT 2,
	`identifier` text NOT NULL,
	`emoji` text,
	`icon_prop` text,
	`cover_image` text,
	`archive_in` integer DEFAULT 0,
	`close_in` integer DEFAULT 0,
	`default_assignee_id` text,
	`default_state_id` text,
	`project_lead_id` text,
	`estimate_id` text,
	`sort_order` real DEFAULT 65535,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_lead_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_workspace_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_identifier_unique` ON `projects` (`workspace_id`,`identifier`);--> statement-breakpoint
CREATE TABLE `states` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`group` text NOT NULL,
	`description` text,
	`sequence` real DEFAULT 65535,
	`is_default` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `state_project_idx` ON `states` (`project_id`);--> statement-breakpoint
CREATE INDEX `state_workspace_idx` ON `states` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `comment_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comment_reaction_comment_idx` ON `comment_reactions` (`comment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reaction_unique` ON `comment_reactions` (`comment_id`,`actor_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `issue_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text,
	`field` text,
	`old_value` text,
	`new_value` text,
	`verb` text NOT NULL,
	`old_identifier` text,
	`new_identifier` text,
	`epoch_timestamp` integer,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_activity_issue_idx` ON `issue_activities` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_activity_project_idx` ON `issue_activities` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_activity_actor_idx` ON `issue_activities` (`actor_id`);--> statement-breakpoint
CREATE TABLE `issue_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_assignee_issue_idx` ON `issue_assignees` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_assignee_assignee_idx` ON `issue_assignees` (`assignee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_assignee_unique` ON `issue_assignees` (`issue_id`,`assignee_id`);--> statement-breakpoint
CREATE TABLE `issue_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text,
	`storage_key` text NOT NULL,
	`uploaded_by_id` text,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_attachment_issue_idx` ON `issue_attachments` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`comment_html` text,
	`comment_stripped` text,
	`comment_json` text,
	`access_level` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_comment_issue_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_comment_actor_idx` ON `issue_comments` (`actor_id`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_label_issue_idx` ON `issue_labels` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_label_label_idx` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_label_unique` ON `issue_labels` (`issue_id`,`label_id`);--> statement-breakpoint
CREATE TABLE `issue_links` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`title` text,
	`url` text NOT NULL,
	`metadata` text,
	`created_by_id` text,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_link_issue_idx` ON `issue_links` (`issue_id`);--> statement-breakpoint
CREATE TABLE `issue_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_reaction_issue_idx` ON `issue_reactions` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_reaction_unique` ON `issue_reactions` (`issue_id`,`actor_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`related_issue_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_relation_issue_idx` ON `issue_relations` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relation_related_idx` ON `issue_relations` (`related_issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relation_unique` ON `issue_relations` (`issue_id`,`related_issue_id`,`relation_type`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`state_id` text,
	`name` text NOT NULL,
	`description_html` text,
	`description_stripped` text,
	`description_binary` text,
	`priority` integer DEFAULT 0,
	`sort_order` real DEFAULT 65535,
	`start_date` integer,
	`target_date` integer,
	`completed_at` integer,
	`archived_at` integer,
	`sequence_id` integer,
	`estimate_point` integer,
	`is_epic` integer DEFAULT false,
	`created_by_id` text,
	`updated_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_project_idx` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_workspace_idx` ON `issues` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `issue_state_idx` ON `issues` (`state_id`);--> statement-breakpoint
CREATE INDEX `issue_parent_idx` ON `issues` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issue_sequence_idx` ON `issues` (`project_id`,`sequence_id`);--> statement-breakpoint
CREATE TABLE `cycle_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cycle_favorite_cycle_idx` ON `cycle_favorites` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `cycle_favorite_user_idx` ON `cycle_favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_favorite_unique` ON `cycle_favorites` (`cycle_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `cycle_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cycle_issue_cycle_idx` ON `cycle_issues` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `cycle_issue_issue_idx` ON `cycle_issues` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_issue_unique` ON `cycle_issues` (`cycle_id`,`issue_id`);--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`start_date` integer,
	`end_date` integer,
	`owned_by_id` text,
	`sort_order` real DEFAULT 65535,
	`view_props` text,
	`progress_snapshot` text,
	`is_active` integer DEFAULT false,
	`archived_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cycle_project_idx` ON `cycles` (`project_id`);--> statement-breakpoint
CREATE INDEX `cycle_workspace_idx` ON `cycles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `module_favorite_module_idx` ON `module_favorites` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_favorite_user_idx` ON `module_favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_favorite_unique` ON `module_favorites` (`module_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `module_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `module_issue_module_idx` ON `module_issues` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_issue_issue_idx` ON `module_issues` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_issue_unique` ON `module_issues` (`module_id`,`issue_id`);--> statement-breakpoint
CREATE TABLE `module_links` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text,
	`url` text NOT NULL,
	`metadata` text,
	`created_by_id` text,
	`created_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `module_link_module_idx` ON `module_links` (`module_id`);--> statement-breakpoint
CREATE TABLE `module_members` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `module_member_module_idx` ON `module_members` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_member_member_idx` ON `module_members` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_member_unique` ON `module_members` (`module_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`description_text` text,
	`description_html` text,
	`start_date` integer,
	`target_date` integer,
	`status` text DEFAULT 'backlog',
	`lead_id` text,
	`sort_order` real DEFAULT 65535,
	`view_props` text,
	`archived_at` integer,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `module_project_idx` ON `modules` (`project_id`);--> statement-breakpoint
CREATE INDEX `module_workspace_idx` ON `modules` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `page_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_favorite_page_idx` ON `page_favorites` (`page_id`);--> statement-breakpoint
CREATE INDEX `page_favorite_user_idx` ON `page_favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_favorite_unique` ON `page_favorites` (`page_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `page_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_label_page_idx` ON `page_labels` (`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_label_unique` ON `page_labels` (`page_id`,`label_id`);--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`description_html` text,
	`description_stripped` text,
	`owned_by_id` text,
	`last_saved_at` integer,
	`created_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_version_page_idx` ON `page_versions` (`page_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`parent_id` text,
	`name` text NOT NULL,
	`description_html` text,
	`description_stripped` text,
	`description_binary` blob,
	`color_prop` text,
	`icon_prop` text,
	`cover_image` text,
	`access_level` integer DEFAULT 0,
	`is_locked` integer DEFAULT false,
	`owned_by_id` text,
	`archived_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_workspace_idx` ON `pages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `page_project_idx` ON `pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `page_parent_idx` ON `pages` (`parent_id`);--> statement-breakpoint
CREATE INDEX `page_owner_idx` ON `pages` (`owned_by_id`);--> statement-breakpoint
CREATE TABLE `view_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`view_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`view_id`) REFERENCES `views`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `view_favorite_view_idx` ON `view_favorites` (`view_id`);--> statement-breakpoint
CREATE INDEX `view_favorite_user_idx` ON `view_favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `view_favorite_unique` ON `view_favorites` (`view_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text,
	`query` text NOT NULL,
	`query_data` text,
	`filters_data` text,
	`display_filters` text,
	`display_properties` text,
	`access_level` integer DEFAULT 1,
	`sort_order` real DEFAULT 65535,
	`is_locked` integer DEFAULT false,
	`owned_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `view_workspace_idx` ON `views` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `view_project_idx` ON `views` (`project_id`);--> statement-breakpoint
CREATE INDEX `view_owner_idx` ON `views` (`owned_by_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`property_change_email` integer DEFAULT true,
	`state_change_email` integer DEFAULT true,
	`comment_email` integer DEFAULT true,
	`mention_email` integer DEFAULT true,
	`issue_completed_email` integer DEFAULT true,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_user_id_unique` ON `notification_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`receiver_id` text NOT NULL,
	`triggered_by_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text,
	`title` text NOT NULL,
	`message` text,
	`message_html` text,
	`message_stripped` text,
	`data` text,
	`read_at` integer,
	`archived_at` integer,
	`snoozed_till` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_receiver_idx` ON `notifications` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `notification_workspace_idx` ON `notifications` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `notification_project_idx` ON `notifications` (`project_id`);--> statement-breakpoint
CREATE INDEX `notification_entity_idx` ON `notifications` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `webhook_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`event_type` text NOT NULL,
	`request_headers` text,
	`request_body` text,
	`response_status` integer,
	`response_headers` text,
	`response_body` text,
	`retry_count` integer DEFAULT 0,
	`created_at` integer,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_log_webhook_idx` ON `webhook_logs` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `webhook_log_workspace_idx` ON `webhook_logs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`url` text NOT NULL,
	`secret_key` text NOT NULL,
	`is_active` integer DEFAULT true,
	`project_event` integer DEFAULT true,
	`issue_event` integer DEFAULT true,
	`module_event` integer DEFAULT false,
	`cycle_event` integer DEFAULT false,
	`issue_comment_event` integer DEFAULT false,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `webhook_workspace_idx` ON `webhooks` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `api_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status_code` integer NOT NULL,
	`response_time` integer,
	`user_agent` text,
	`ip_address` text,
	`request_body` text,
	`response_body` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `api_log_user_idx` ON `api_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_log_created_at_idx` ON `api_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0,
	`max_attempts` integer DEFAULT 3,
	`last_error` text,
	`run_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `job_status_queue_idx` ON `jobs` (`status`,`queue`,`run_at`);--> statement-breakpoint
CREATE INDEX `job_name_idx` ON `jobs` (`name`);--> statement-breakpoint
CREATE TABLE `file_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`entity_type` text,
	`entity_id` text,
	`asset_type` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text,
	`storage_key` text NOT NULL,
	`storage_provider` text DEFAULT 'local',
	`uploaded_by_id` text,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `file_asset_workspace_idx` ON `file_assets` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `file_asset_entity_idx` ON `file_assets` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `file_asset_uploaded_by_idx` ON `file_assets` (`uploaded_by_id`);--> statement-breakpoint
CREATE TABLE `github_comment_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`github_comment_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_comment_sync_issue_idx` ON `github_comment_syncs` (`issue_id`);--> statement-breakpoint
CREATE TABLE `github_issue_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`github_issue_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_issue_sync_issue_idx` ON `github_issue_syncs` (`issue_id`);--> statement-breakpoint
CREATE INDEX `github_issue_sync_github_idx` ON `github_issue_syncs` (`github_issue_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`provider` text NOT NULL,
	`description` text,
	`avatar` text,
	`network` integer DEFAULT 1,
	`is_active` integer DEFAULT true,
	`metadata` text,
	`verified` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_provider_unique` ON `integrations` (`provider`);--> statement-breakpoint
CREATE TABLE `project_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_integration_id` text NOT NULL,
	`actor_id` text,
	`config` text,
	`is_active` integer DEFAULT true,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_integration_id`) REFERENCES `workspace_integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_integration_project_idx` ON `project_integrations` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_integration_workspace_int_idx` ON `project_integrations` (`workspace_integration_id`);--> statement-breakpoint
CREATE TABLE `workspace_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`actor_id` text,
	`api_token` text,
	`metadata` text,
	`config` text,
	`is_active` integer DEFAULT true,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_integration_workspace_idx` ON `workspace_integrations` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_integration_unique` ON `workspace_integrations` (`workspace_id`,`integration_id`);