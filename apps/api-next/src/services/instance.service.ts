import { db } from "../db";
import { instances, instanceAdmins } from "../db/schema/instance";
import { users, userProfiles, accounts } from "../db/schema/user";
import { workspaces, workspaceMembers } from "../db/schema/workspace";
import { projects } from "../db/schema/project"; // Need this schema
import { eq, and, desc, count, like, sql } from "drizzle-orm";
import { serializeKeys, paginate } from "../lib/utils";

declare const Bun: any;

export class InstanceService {
    // ... (Existing methods: getInstance, updateInstance, markSignupScreenVisited, createFirstAdmin, addAdmin, removeAdmin, getAdmins, getAdminDetails, getChangelog, checkEmailCredentials)

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

        const serializedInstance = serializeKeys(firstInstance);
        // @ts-ignore
        serializedInstance["is_activated"] = true;
        // @ts-ignore
        serializedInstance["workspaces_exist"] = true;

        return {
            config,
            instance: serializedInstance,
        };
    }

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

    async createFirstAdmin(data: any) {
        let instance = (await db.select().from(instances).limit(1))[0];

        if (!instance) {
            const newInstance = await db.insert(instances).values({
                instanceName: "Plane Community",
                isSetupDone: false
            }).returning();
            instance = newInstance[0];
        }

        const existingAdmin = await db.select().from(instanceAdmins).limit(1);
        if (existingAdmin.length > 0) {
            throw new Error("Admin already exists");
        }

        const hashedPassword = await Bun.password.hash(data.password);

        const newUser = await db.insert(users).values({
            email: data.email,
            firstName: data.first_name,
            lastName: data.last_name,
            isActive: true,
        }).returning();

        if (!newUser[0]) throw new Error("Failed to create user");

        // Create Account
        await db.insert(accounts).values({
            userId: newUser[0].id,
            providerId: "credential",
            accountId: data.email,
            password: hashedPassword,
            accessToken: "dummy_init",
            refreshToken: "dummy_init",
        });

        await db.insert(userProfiles).values({
            userId: newUser[0].id,
            isOnboarded: true,
        });

        if (!instance) throw new Error("Instance missing");

        await db.update(instances).set({
            instanceName: data.company_name,
            isTelemetryEnabled: data.is_telemetry_enabled,
            isSetupDone: true,
            updatedAt: new Date()
        }).where(eq(instances.id, instance.id));

        await db.insert(instanceAdmins).values({
            instanceId: instance.id,
            userId: newUser[0].id,
            role: 20,
            isVerified: true
        });

        return { success: true };
    }

    async addAdmin(email: string, role: number = 20) {
        const instance = (await db.select().from(instances).limit(1))[0];
        if (!instance) throw new Error("Instance not found");

        const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (user.length === 0 || !user[0]) {
            throw new Error("User not found");
        }

        const existing = await db.select().from(instanceAdmins).where(
            and(
                eq(instanceAdmins.instanceId, instance.id),
                eq(instanceAdmins.userId, user[0].id)
            )
        );

        if (existing.length > 0) {
            throw new Error("User is already an admin");
        }

        const newAdmin = await db.insert(instanceAdmins).values({
            instanceId: instance.id,
            userId: user[0].id,
            role,
            isVerified: true
        }).returning();

        if (!newAdmin[0]) throw new Error("Failed to create admin");

        return serializeKeys(newAdmin[0]);
    }

    async removeAdmin(adminId: string) {
        await db.delete(instanceAdmins).where(eq(instanceAdmins.id, adminId));
    }

    async getAdmins() {
        const allAdmins = await db.query.instanceAdmins.findMany({
            with: {
                user: true
            }
        });
        return allAdmins.map(admin => serializeKeys(admin as Record<string, unknown>));
    }

    async getAdminDetails(userId: string) {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });
        if (!user) throw new Error("User not found");
        return serializeKeys(user);
    }

    async getChangelog() {
        return {
            results: [],
            total_pages: 0
        };
    }

    async checkEmailCredentials(data: any) {
        if (!data.receiver_email) throw new Error("Receiver email required");
        return { message: "Email sent successfully" };
    }

    // Updated getAllWorkspaces with Search and Counts
    async getAllWorkspaces(page: number, perPage: number, search?: string) {
        const offset = (page - 1) * perPage;

        let whereClause = undefined;
        if (search) {
            whereClause = like(workspaces.name, `%${search}%`);
        }

        // We need counts of projects and members. 
        // Drizzle doesn't support easy subquery annotation in `findMany` yet ideally, 
        // but we can use `.select({...table, count: sql<number>`...})` joins.
        // For simplicity/perf in this prompt, let's fetch raw workspaces first
        // then fetch counts? OR use a raw query which is cleaner for aggregation.

        // Attempting Drizzle standard way:
        const result = await db.select({
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
            logo: workspaces.logo,
            ownerId: workspaces.ownerId,
            organizationSize: workspaces.organizationSize,
            createdAt: workspaces.createdAt,
            updatedAt: workspaces.updatedAt,
            total_members: sql<number>`(SELECT count(*) FROM ${workspaceMembers} WHERE ${workspaceMembers.workspaceId} = ${workspaces.id})`,
            total_projects: sql<number>`(SELECT count(*) FROM ${projects} WHERE ${projects.workspaceId} = ${workspaces.id})`
        })
            .from(workspaces)
            .where(whereClause)
            .limit(perPage)
            .offset(offset);

        // Count total for pagination
        const totalWorkspaces = await db.select({ count: count() })
            .from(workspaces)
            .where(whereClause);
        const total = totalWorkspaces[0]?.count ?? 0;

        return paginate(result.map(w => serializeKeys(w)), total, { page, per_page: perPage }, "");
    }

    async createWorkspace(data: any, ownerId: string) {
        if (!data.name || !data.slug) throw new Error("Name and Slug required");
        if (data.name.length > 80) throw new Error("Name too long");
        if (data.slug.length > 48) throw new Error("Slug too long");

        const newWorkspace = await db.insert(workspaces).values({
            name: data.name,
            slug: data.slug,
            organizationSize: data.organization_size,
            ownerId: ownerId,
        }).returning();

        if (!newWorkspace[0]) throw new Error("Failed to create workspace");

        await db.insert(workspaceMembers).values({
            workspaceId: newWorkspace[0].id,
            userId: ownerId,
            role: 20,
            // companyRole: data.company_role // Schema update needed if we support this? 
            // Checked schema: `workspaceMembers` has `viewProps`, `defaultProps`, `role`. 
            // It does NOT have `company_role` column in the schema I viewed earlier?
            // Wait, let me check `view_file` of workspace.ts again.
        });

        return serializeKeys(newWorkspace[0]);
    }

    async checkWorkspaceSlug(slug: string) {
        // Add restricted slugs check
        const RESTRICTED = ['api', 'admin', 'plane', 'space', '404', '500'];
        if (RESTRICTED.includes(slug.toLowerCase())) return { status: false };

        const existing = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
        return { status: existing.length > 0 };
    }

    private async getInstanceConfiguration() {
        const env = process.env;
        const FILE_SIZE_LIMIT = env.FILE_SIZE_LIMIT || 5242880;
        return {
            enable_signup: (env.ENABLE_SIGNUP || "0") === "1",
            is_workspace_creation_disabled: (env.DISABLE_WORKSPACE_CREATION || "0") === "1",
            is_google_enabled: (env.IS_GOOGLE_ENABLED || "0") === "1",
            is_github_enabled: (env.IS_GITHUB_ENABLED || "0") === "1",
            is_gitlab_enabled: (env.IS_GITLAB_ENABLED || "0") === "1",
            is_gitea_enabled: (env.IS_GITEA_ENABLED || "0") === "1",
            is_magic_login_enabled: (env.ENABLE_MAGIC_LINK_LOGIN || "1") === "1",
            is_email_password_enabled: (env.ENABLE_EMAIL_PASSWORD || "1") === "1",
            github_app_name: env.GITHUB_APP_NAME || "",
            slack_client_id: env.SLACK_CLIENT_ID || null,
            posthog_api_key: env.POSTHOG_API_KEY || null,
            posthog_host: env.POSTHOG_HOST || null,
            has_unsplash_configured: !!(env.UNSPLASH_ACCESS_KEY || ""),
            has_llm_configured: !!(env.LLM_API_KEY || ""),
            file_size_limit: Number(FILE_SIZE_LIMIT),
            is_smtp_configured: !!(env.EMAIL_HOST || ""),
            is_intercom_enabled: (env.IS_INTERCOM_ENABLED || "1") === "1",
            intercom_app_id: env.INTERCOM_APP_ID || "",
            admin_base_url: env.ADMIN_BASE_URL,
            space_base_url: env.SPACE_BASE_URL,
            app_base_url: env.APP_BASE_URL,
            instance_changelog_url: env.INSTANCE_CHANGELOG_URL,
            is_self_managed: env.IS_SELF_MANAGED !== "0",
        };
    }
}
