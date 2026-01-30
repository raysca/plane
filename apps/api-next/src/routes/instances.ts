import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { InstanceService } from "../services/instance.service";
import { InstanceConfigurationService } from "../services/instance-configuration.service";
import { db } from "../db";
import { users, instanceAdmins, accounts } from "../db/schema";
import { workspaces } from "../db/schema/workspace";
import { eq, and } from "drizzle-orm";
import type { Variables } from "../app";
import { seedWorkspace } from "../lib/workspace-seeder";
import { auth } from "../lib/auth";

declare const Bun: any;

const instanceRoutes = new Hono<{ Variables: Variables }>();
const instanceService = new InstanceService();
const configService = new InstanceConfigurationService();

const isInstanceAdmin = async (c: any, next: any) => {
    // Resolve session if user not already set on context
    let user = c.get("user");
    if (!user) {
        try {
            const session = await auth.api.getSession({ headers: c.req.raw.headers });
            if (session?.user) {
                c.set("user", session.user);
                c.set("session", session.session);
                user = session.user;
            }
        } catch {
            // session resolution failed
        }
    }
    if (!user) {
        return c.json({ detail: "Authentication required" }, 401);
    }

    // Check if user is admin
    const adminRecord = await db.select().from(instanceAdmins)
        .where(eq(instanceAdmins.userId, user.id))
        .limit(1);

    if (adminRecord.length === 0) {
        return c.json({ detail: "Permission denied" }, 403);
    }

    await next();
};

instanceRoutes.get("/", async (c) => {
    const result = await instanceService.getInstance();
    return c.json(result);
});

instanceRoutes.get("/changelog/", async (c) => {
    const changelog = await instanceService.getChangelog();
    return c.json(changelog);
});

instanceRoutes.post("/admins/sign-up-screen-visited/", async (c) => {
    try {
        await instanceService.markSignupScreenVisited();
        return c.body(null, 204);
    } catch (error) {
        return c.json({ detail: "Instance not found" }, 400);
    }
});

instanceRoutes.post("/admins/sign-up/", async (c) => {
    try {
        let payload: any = {};
        const contentType = c.req.header("content-type");

        if (contentType?.includes("application/json")) {
            payload = await c.req.json();
        } else {
            const body = await c.req.parseBody();
            // Form data keys match the JSON expected keys mostly
            payload = {
                email: body["email"],
                password: body["password"],
                first_name: body["first_name"],
                last_name: body["last_name"],
                company_name: body["company_name"],
                is_telemetry_enabled: body["is_telemetry_enabled"] === "True",
            };
        }

        await instanceService.createFirstAdmin(payload);

        // Success! Redirect to general settings (or login? Django redirects to general)
        return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/general`);
    } catch (error: any) {
        // Redirect back with error
        return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/?error_code=AUTHENTICATION_FAILED&error_message=${encodeURIComponent(error.message)}`);
    }
});

instanceRoutes.post("/admins/sign-in/", async (c) => {
    try {
        let email, password;
        const contentType = c.req.header("content-type");

        if (contentType?.includes("application/json")) {
            const body = await c.req.json();
            email = body.email;
            password = body.password;
        } else {
            const body = await c.req.parseBody();
            email = body["email"];
            password = body["password"];
        }

        if (!email || !password) return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=Email and password required`);

        const user = await db.query.users.findFirst({
            where: eq(users.email, email as string)
        });

        if (!user) {
            // Return simplified error for form submission redirect handling if needed, 
            // but usually API returns JSON error and frontend handles it?
            // Actually, standard form submission expects a REDIRECT on success/failure usually, 
            // but `sign-in-form.tsx` has `action` but also `onSubmit` setting state.
            // If it's a native form submit, the browser navigates to the response.
            // Django views typically redirect or render HTML.
            // But looking at `sign-in-form.tsx`, it's a native form submission.
            // Wait, if it's native form submit, the response MUST be a redirect.
            // Sending JSON back will display JSON in the browser window!
            return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=Invalid credentials`);
        }

        const credentialsAccount = await db.query.accounts.findFirst({
            where: and(
                eq(accounts.userId, user.id),
                eq(accounts.providerId, "credential")
            )
        });

        if (!credentialsAccount || !credentialsAccount.password) {
            return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=Invalid credentials`);
        }

        // @ts-ignore
        const isValid = await Bun.password.verify(password as string, credentialsAccount.password);
        if (!isValid) {
            return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=Invalid credentials`);
        }

        const admin = await db.query.instanceAdmins.findFirst({
            where: eq(instanceAdmins.userId, user.id)
        });

        if (!admin) {
            return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=Not an instance admin`);
        }

        // Success! Redirect to dashboard root? or home?
        // Django implementation: `url = urljoin(base_host(request=request, is_admin=True), "general/")` -> Redirects to /general/
        return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/general`);

    } catch (e: any) {
        return c.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/authentication?error_code=AUTHENTICATION_FAILED&error_message=${encodeURIComponent(e.message)}`);
    }
});

instanceRoutes.patch("/", isInstanceAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const result = await instanceService.updateInstance(body);
        return c.json(result);
    } catch (error) {
        return c.json({ detail: "Failed to update instance" }, 400);
    }
});

// Configurations

instanceRoutes.get("/configurations/", isInstanceAdmin, async (c) => {
    const configs = await configService.getConfigurations();
    return c.json(configs);
});

instanceRoutes.patch("/configurations/", isInstanceAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const result = await configService.updateConfigurations(body);
        return c.json(result);
    } catch (e) {
        return c.json({ detail: "Failed to update configurations" }, 400);
    }
});

instanceRoutes.post("/email-credentials-check/", isInstanceAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const result = await instanceService.checkEmailCredentials(body);
        return c.json(result);
    } catch (e: any) {
        return c.json({ detail: e.message }, 400);
    }
});

instanceRoutes.delete("/configurations/disable-email-feature/", isInstanceAdmin, async (c) => {
    await configService.disableEmailFeature();
    return c.body(null, 204);
});

// Admin Management

instanceRoutes.get("/admins/", isInstanceAdmin, async (c) => {
    const admins = await instanceService.getAdmins();
    return c.json(admins);
});

instanceRoutes.get("/admins/me/", isInstanceAdmin, async (c) => {
    const user = c.get("user");
    // isInstanceAdmin ensures user exists
    const adminDetails = await instanceService.getAdminDetails(user!.id);
    return c.json(adminDetails);
});

instanceRoutes.post("/admins/", isInstanceAdmin, async (c) => {
    try {
        const { email, role } = await c.req.json();
        const result = await instanceService.addAdmin(email, role);
        return c.json(result, 201);
    } catch (e: any) {
        return c.json({ detail: e.message }, 400);
    }
});

instanceRoutes.delete("/admins/:id/", isInstanceAdmin, async (c) => {
    const id = c.req.param("id");
    await instanceService.removeAdmin(id);
    return c.body(null, 204);
});

// Workspace Management (Instance Admin)

instanceRoutes.get("/workspaces/", isInstanceAdmin, async (c) => {
    const page = Number(c.req.query("page")) || 1;
    const perPage = Number(c.req.query("per_page")) || 50;
    const search = c.req.query("search");

    // Instance admins can see all workspaces usually?
    const result = await instanceService.getAllWorkspaces(page, perPage, search);
    return c.json(result);
});

instanceRoutes.post("/workspaces/", isInstanceAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const user = c.get("user");
        const result = await instanceService.createWorkspace(body, user!.id);
        return c.json(result, 201);
    } catch (e: any) {
        return c.json({ detail: e.message }, 400);
    }
});

instanceRoutes.get("/workspace-slug-check/", async (c) => {
    // This might not need admin perms? Signup flows use it.
    // Check if protected or public? Usually public for validation.
    const slug = c.req.query("slug");
    if (!slug) return c.json({ status: false });
    const result = await instanceService.checkWorkspaceSlug(slug);
    return c.json(result);
});


// Seed Data
instanceRoutes.post("/seed/", isInstanceAdmin, async (c) => {
    try {
        const body = await c.req.json();
        const workspaceId = body.workspace_id;

        if (!workspaceId) {
            return c.json({ detail: "workspace_id is required" }, 400);
        }

        // Verify workspace exists
        const workspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.id, workspaceId),
        });
        if (!workspace) {
            return c.json({ detail: "Workspace not found" }, 404);
        }

        const user = c.get("user");
        await seedWorkspace(workspaceId, user!.id);

        return c.json({ status: "success", message: "Workspace seeded successfully" });
    } catch (error: any) {
        return c.json({ detail: error.message || "Failed to seed workspace" }, 400);
    }
});

export { instanceRoutes };
