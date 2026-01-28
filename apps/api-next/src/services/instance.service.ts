import { db } from "../db";
import { instances, instanceConfigurations } from "../db/schema";
import { eq } from "drizzle-orm";
import { serializeKeys } from "../lib/utils";

export class InstanceService {
    /**
     * Get the instance configuration and details
     */
    async getInstance() {
        const instance = await db.select().from(instances).limit(1);
        const firstInstance = instance[0];

        if (!firstInstance) {
            return {
                config: {},
                instance: {
                    is_activated: false,
                    is_setup_done: false,
                },
            };
        }

        const config = await this.getInstanceConfiguration();

        // Convert instance to snake_case for API response compatibility
        const serializedInstance = serializeKeys(firstInstance);

        // Add computed fields
        serializedInstance["is_activated"] = true;
        serializedInstance["workspaces_exist"] = true; // TODO: Check actual workspace count

        return {
            config,
            instance: serializedInstance,
        };
    }

    /**
     * Update instance details
     */
    async updateInstance(data: Partial<typeof instances.$inferInsert>) {
        const instance = await db.select().from(instances).limit(1);
        const firstInstance = instance[0];

        if (!firstInstance) {
            throw new Error("Instance not found");
        }

        const updatedInstance = await db
            .update(instances)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(instances.id, firstInstance.id))
            .returning();

        if (!updatedInstance[0]) {
            throw new Error("Failed to update instance");
        }

        return serializeKeys(updatedInstance[0]);
    }

    /**
     * Mark signup screen as visited
     */
    async markSignupScreenVisited() {
        const instance = await db.select().from(instances).limit(1);
        const firstInstance = instance[0];

        if (!firstInstance) {
            throw new Error("Instance not found");
        }

        await db
            .update(instances)
            .set({
                isSignupScreenVisited: true,
                updatedAt: new Date(),
            })
            .where(eq(instances.id, firstInstance.id));
    }

    /**
     * Get aggregated configuration from DB and Env
     */
    private async getInstanceConfiguration() {
        // TODO: Fetch from DB and overlay (skipping DB fetch for now to keep simple matching existing Env usage)

        const env = process.env;

        /* 
          Matching logic from plane/license/api/views/instance.py
          Default values are taken from the Django implementation
        */

        const ENABLE_SIGNUP = env.ENABLE_SIGNUP || "0";
        const DISABLE_WORKSPACE_CREATION = env.DISABLE_WORKSPACE_CREATION || "0";
        const IS_GOOGLE_ENABLED = env.IS_GOOGLE_ENABLED || "0";
        const IS_GITHUB_ENABLED = env.IS_GITHUB_ENABLED || "0";
        const GITHUB_APP_NAME = env.GITHUB_APP_NAME || "";
        const IS_GITLAB_ENABLED = env.IS_GITLAB_ENABLED || "0";
        const IS_GITEA_ENABLED = env.IS_GITEA_ENABLED || "0";
        const EMAIL_HOST = env.EMAIL_HOST || "";
        const ENABLE_MAGIC_LINK_LOGIN = env.ENABLE_MAGIC_LINK_LOGIN || "1";
        const ENABLE_EMAIL_PASSWORD = env.ENABLE_EMAIL_PASSWORD || "1";
        const SLACK_CLIENT_ID = env.SLACK_CLIENT_ID || null;
        const POSTHOG_API_KEY = env.POSTHOG_API_KEY || null;
        const POSTHOG_HOST = env.POSTHOG_HOST || null;
        const UNSPLASH_ACCESS_KEY = env.UNSPLASH_ACCESS_KEY || "";
        const LLM_API_KEY = env.LLM_API_KEY || "";
        const IS_INTERCOM_ENABLED = env.IS_INTERCOM_ENABLED || "1";
        const INTERCOM_APP_ID = env.INTERCOM_APP_ID || "";
        const FILE_SIZE_LIMIT = env.FILE_SIZE_LIMIT || 5242880;

        return {
            enable_signup: ENABLE_SIGNUP === "1",
            is_workspace_creation_disabled: DISABLE_WORKSPACE_CREATION === "1",
            is_google_enabled: IS_GOOGLE_ENABLED === "1",
            is_github_enabled: IS_GITHUB_ENABLED === "1",
            is_gitlab_enabled: IS_GITLAB_ENABLED === "1",
            is_gitea_enabled: IS_GITEA_ENABLED === "1",
            is_magic_login_enabled: ENABLE_MAGIC_LINK_LOGIN === "1",
            is_email_password_enabled: ENABLE_EMAIL_PASSWORD === "1",
            github_app_name: GITHUB_APP_NAME,
            slack_client_id: SLACK_CLIENT_ID,
            posthog_api_key: POSTHOG_API_KEY,
            posthog_host: POSTHOG_HOST,
            has_unsplash_configured: !!UNSPLASH_ACCESS_KEY,
            has_llm_configured: !!LLM_API_KEY,
            file_size_limit: Number(FILE_SIZE_LIMIT),
            is_smtp_configured: !!EMAIL_HOST,
            is_intercom_enabled: IS_INTERCOM_ENABLED === "1",
            intercom_app_id: INTERCOM_APP_ID,

            // Base URLs
            admin_base_url: env.ADMIN_BASE_URL,
            space_base_url: env.SPACE_BASE_URL,
            app_base_url: env.APP_BASE_URL,

            instance_changelog_url: env.INSTANCE_CHANGELOG_URL,
            is_self_managed: env.IS_SELF_MANAGED !== "0", // Default to true typically?
        };
    }
}
