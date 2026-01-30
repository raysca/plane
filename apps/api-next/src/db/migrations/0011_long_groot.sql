ALTER TABLE `projects` ADD `logo_props` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `cycle_view` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `projects` ADD `module_view` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_views_view` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `projects` ADD `page_view` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `projects` ADD `intake_view` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `guest_view_all_features` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_time_tracking_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_issue_type_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_member_added` integer DEFAULT false;