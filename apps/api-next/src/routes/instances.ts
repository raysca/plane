import { Hono } from "hono";
import { InstanceService } from "../services/instance.service";
import type { Variables } from "../app";

const instanceRoutes = new Hono<{ Variables: Variables }>();
const instanceService = new InstanceService();

instanceRoutes.get("/", async (c) => {
    const result = await instanceService.getInstance();
    return c.json(result);
});

instanceRoutes.patch("/", async (c) => {
    const user = c.get("user");
    // TODO: Add proper Admin permission check. 
    // For now, we assume if you are authenticated you might be allowed in dev, 
    // but strictly we should check InstanceAdmin role.
    if (!user) {
        return c.json({ detail: "Authentication required" }, 401);
    }

    try {
        const body = await c.req.json();
        const result = await instanceService.updateInstance(body);
        return c.json(result);
    } catch (error) {
        // TODO: Better error handling
        return c.json({ detail: "Failed to update instance" }, 400);
    }
});

instanceRoutes.post("/admins/sign-up-screen-visited/", async (c) => {
    try {
        await instanceService.markSignupScreenVisited();
        return c.body(null, 204);
    } catch (error) {
        return c.json({ detail: "Instance not found" }, 400);
    }
});

export { instanceRoutes };
