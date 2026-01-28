CREATE TABLE `instance_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` integer DEFAULT 20,
	`is_verified` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instance_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`category` text NOT NULL,
	`is_encrypted` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_configurations_key_unique` ON `instance_configurations` (`key`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_name` text,
	`whitelist_emails` text,
	`instance_id` text,
	`current_version` text,
	`latest_version` text,
	`edition` text DEFAULT 'PLANE_COMMUNITY',
	`domain` text,
	`last_checked_at` integer,
	`namespace` text,
	`is_telemetry_enabled` integer DEFAULT true,
	`is_support_required` integer DEFAULT true,
	`is_setup_done` integer DEFAULT false,
	`is_signup_screen_visited` integer DEFAULT false,
	`is_verified` integer DEFAULT false,
	`is_test` integer DEFAULT false,
	`is_current_version_deprecated` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_instance_id_unique` ON `instances` (`instance_id`);