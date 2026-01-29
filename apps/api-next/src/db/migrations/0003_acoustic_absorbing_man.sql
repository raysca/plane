ALTER TABLE `user_profiles` ADD `last_workspace_id` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `use_case` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `onboarding_step` text DEFAULT '{"profile_complete":false,"workspace_create":false,"workspace_invite":false,"workspace_join":false}';--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `is_tour_completed` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `is_onboarded` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `billing_address` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `billing_address_country` text DEFAULT 'INDIA';--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `company_name` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `has_marketing_email_consent` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_onboarded`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_tour_completed`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `onboarding_step`;