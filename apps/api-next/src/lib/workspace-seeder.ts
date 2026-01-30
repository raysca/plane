
import { db } from "../db";
import { users } from "../db/schema/user";
import {
    workspaces,
    workspaceMembers,
} from "../db/schema/workspace";
import {
    projects,
    projectMembers,
    states,
    labels,
} from "../db/schema/project";
import {
    issues,
    issueLabels,
    issueActivities,
    issueAssignees,
} from "../db/schema/issue";
import {
    cycles,
    cycleIssues,
} from "../db/schema/cycle";
import {
    modules,
    moduleIssues,
} from "../db/schema/module";
import {
    pages,
    pageLabels,
    pageVersions,
} from "../db/schema/page";
import {
    views,
} from "../db/schema/view";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import path from "path";
import fs from "fs/promises";

// Types for seed data
type SeedProject = {
    id: number;
    name: string;
    identifier: string;
    description: string;
    network: number;
    cover_image?: string;
    logo_props?: any;
};

type SeedState = {
    id: number;
    name: string;
    color: string;
    sequence: number;
    group: string; // "backlog" | "unstarted" | "started" | "completed" | "cancelled"
    default: boolean;
    project_id: number;
};

type SeedLabel = {
    id: number;
    name: string;
    color: string;
    sort_order: number;
    project_id: number;
    description?: string;
};

type SeedCycle = {
    id: number;
    name: string;
    description?: string;
    start_date?: string;
    end_date?: string;
    project_id: number;
    type?: "CURRENT" | "UPCOMING";
};

type SeedModule = {
    id: number;
    name: string;
    description: string;
    project_id: number;
    status: string;
    lead_id?: string;
};

type SeedIssue = {
    id: number;
    name: string;
    description_html?: string;
    priority: string;
    state_id: number;
    project_id: number;
    labels: number[];
    cycle_id?: number | null;
    module_ids?: number[];
};

type SeedView = {
    id: number;
    name: string;
    description?: string;
    query: any;
    project_id: number;
};

type SeedPage = {
    id: number;
    name: string;
    description_html?: string;
    access: number;
    project_id?: number;
    type?: string;
    labels?: number[];
    children?: SeedPage[];
    is_locked?: boolean;
    archived?: boolean;
};

// Helper to read JSON files
async function readSeedFile<T>(filename: string): Promise<T | null> {
    try {
        const filePath = path.join(process.cwd(), "src", "db", "seeds", "data", filename);
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content);
    } catch (error) {
        console.warn(`Seed file not found: ${filename}`, error);
        return null;
    }
}

// Map priority string to integer
function getPriority(priority: string): number {
    const map: Record<string, number> = {
        urgent: 1,
        high: 2,
        medium: 3,
        low: 4,
        none: 0,
    };
    return map[priority.toLowerCase()] || 0;
}

// Helper to seed a single page (and its children recursively)
async function seedPage(
    seed: SeedPage,
    workspaceId: string,
    projectId: string | undefined,
    userId: string,
    parentId: string | null,
    labelMap: Record<number, string>,
) {
    const [newPage] = await db.insert(pages).values({
        workspaceId,
        projectId,
        parentId,
        name: seed.name,
        descriptionHtml: seed.description_html,
        accessLevel: seed.access,
        ownedById: userId,
        isLocked: seed.is_locked ?? false,
        archivedAt: seed.archived ? new Date() : null,
    }).returning();

    if (!newPage) return;

    console.log(`[Seeder] Created page ${newPage.name}${parentId ? " (child)" : ""}`);

    // Create page labels
    if (seed.labels?.length) {
        for (const labelSeedId of seed.labels) {
            const labelId = labelMap[labelSeedId];
            if (labelId) {
                await db.insert(pageLabels).values({
                    pageId: newPage.id,
                    labelId,
                });
            }
        }
    }

    // Create an initial version snapshot
    await db.insert(pageVersions).values({
        pageId: newPage.id,
        descriptionHtml: seed.description_html ?? null,
        ownedById: userId,
        lastSavedAt: new Date(),
    });

    // Recursively create children
    if (seed.children?.length) {
        for (const child of seed.children) {
            await seedPage(child, workspaceId, projectId, userId, newPage.id, labelMap);
        }
    }
}

export async function seedWorkspace(workspaceId: string, userId: string) {
    console.log(`[Seeder] Seeding workspace ${workspaceId} for user ${userId}`);

    try {
        const workspace = await db.query.workspaces.findFirst({
            where: eq(workspaces.id, workspaceId),
        });

        if (!workspace) throw new Error("Workspace not found");

        // 2. Create Project
        const projectSeeds = await readSeedFile<SeedProject[]>("projects.json");
        if (!projectSeeds?.length) return;

        const projectMap: Record<number, string> = {};

        for (const seed of projectSeeds) {
            const identifier = workspace.name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 5).toUpperCase() || "PROJ";

            const [newProject] = await db.insert(projects).values({
                workspaceId: workspace.id,
                name: workspace.name,
                identifier: identifier,
                description: seed.description,
                network: seed.network,
                coverImage: seed.cover_image,
                iconProp: seed.logo_props,
                createdById: userId,
                projectLeadId: userId,
            }).returning();

            if (!newProject) continue;

            projectMap[seed.id] = newProject.id;
            console.log(`[Seeder] Created project ${newProject.name} (${newProject.id})`);

            // Add user as member
            await db.insert(projectMembers).values({
                projectId: newProject.id,
                memberId: userId,
                role: 20, // Admin
            });
        }

        // 3. Create States
        const stateSeeds = await readSeedFile<SeedState[]>("states.json");
        const stateMap: Record<number, string> = {};

        if (stateSeeds?.length) {
            for (const seed of stateSeeds) {
                const projectId = projectMap[seed.project_id];
                if (!projectId) continue;

                const [newState] = await db.insert(states).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    name: seed.name,
                    color: seed.color,
                    sequence: seed.sequence,
                    group: seed.group,
                    isDefault: seed.default,
                    description: "",
                }).returning();

                if (newState) {
                    stateMap[seed.id] = newState.id;

                    if (seed.default) {
                        await db.update(projects)
                            .set({ defaultStateId: newState.id })
                            .where(eq(projects.id, projectId));
                    }
                }
            }
        }

        // 4. Create Labels
        const labelSeeds = await readSeedFile<SeedLabel[]>("labels.json");
        const labelMap: Record<number, string> = {};

        if (labelSeeds?.length) {
            for (const seed of labelSeeds) {
                const projectId = projectMap[seed.project_id];
                if (!projectId) continue;

                const [newLabel] = await db.insert(labels).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    name: seed.name,
                    color: seed.color,
                    sortOrder: seed.sort_order,
                    description: seed.description,
                    createdById: userId,
                }).returning();

                if (newLabel) labelMap[seed.id] = newLabel.id;
            }
        }

        // 5. Create Cycles
        const cycleSeeds = await readSeedFile<SeedCycle[]>("cycles.json");
        const cycleMap: Record<number, string> = {};

        if (cycleSeeds?.length) {
            for (const seed of cycleSeeds) {
                const projectId = projectMap[seed.project_id];
                if (!projectId) continue;

                let startDate = new Date();
                let endDate = new Date();
                endDate.setDate(endDate.getDate() + 14);

                if (seed.type === "UPCOMING") {
                    startDate.setDate(startDate.getDate() + 14);
                    endDate.setDate(endDate.getDate() + 14);
                }

                const [newCycle] = await db.insert(cycles).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    name: seed.name,
                    description: seed.description,
                    startDate: startDate,
                    endDate: endDate,
                    ownedById: userId,
                }).returning();

                if (newCycle) cycleMap[seed.id] = newCycle.id;
            }
        }

        // 6. Create Modules
        const moduleSeeds = await readSeedFile<SeedModule[]>("modules.json");
        const moduleMap: Record<number, string> = {};

        if (moduleSeeds?.length) {
            for (const seed of moduleSeeds) {
                const projectId = projectMap[seed.project_id];
                if (!projectId) continue;

                const [newModule] = await db.insert(modules).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    name: seed.name,
                    description: seed.description,
                    status: seed.status,
                    leadId: userId,
                    createdById: userId,
                }).returning();

                if (newModule) moduleMap[seed.id] = newModule.id;
            }
        }

        // 7. Create Issues
        const issueSeeds = await readSeedFile<SeedIssue[]>("issues.json");

        if (issueSeeds?.length) {
            for (const seed of issueSeeds) {
                const projectId = projectMap[seed.project_id];
                const stateId = stateMap[seed.state_id];

                if (!projectId || !stateId) continue;

                const [newIssue] = await db.insert(issues).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    stateId: stateId,
                    name: seed.name,
                    descriptionHtml: seed.description_html,
                    priority: getPriority(seed.priority),
                    createdById: userId,
                }).returning();

                if (!newIssue) continue;

                console.log(`[Seeder] Created issue ${newIssue.name}`);

                // Issue Activity
                await db.insert(issueActivities).values({
                    issueId: newIssue.id,
                    projectId: projectId,
                    workspaceId: workspace.id,
                    actorId: userId,
                    verb: "created",
                    field: "issue",
                });

                // Issue Labels
                if (seed.labels && seed.labels.length) {
                    for (const labelId of seed.labels) {
                        const mappedLabelId = labelMap[labelId];
                        if (mappedLabelId) {
                            await db.insert(issueLabels).values({
                                issueId: newIssue.id,
                                labelId: mappedLabelId
                            });
                        }
                    }
                }

                // Cycle Issues
                if (seed.cycle_id) {
                    const cycleId = cycleMap[seed.cycle_id];
                    if (cycleId) {
                        await db.insert(cycleIssues).values({
                            issueId: newIssue.id,
                            cycleId: cycleId
                        });
                    }
                }

                // Module Issues
                if (seed.module_ids && seed.module_ids.length) {
                    for (const modId of seed.module_ids) {
                        const moduleId = moduleMap[modId];
                        if (moduleId) {
                            await db.insert(moduleIssues).values({
                                issueId: newIssue.id,
                                moduleId: moduleId
                            });
                        }
                    }
                }
            }
        }

        // 8. Create Views
        const viewSeeds = await readSeedFile<SeedView[]>("views.json");
        if (viewSeeds?.length) {
            for (const seed of viewSeeds) {
                const projectId = projectMap[seed.project_id];
                if (!projectId) continue;

                await db.insert(views).values({
                    projectId: projectId,
                    workspaceId: workspace.id,
                    name: seed.name,
                    description: seed.description,
                    query: seed.query,
                    accessLevel: 2, // Workspace public
                    ownedById: userId,
                });
            }
        }

        // 9. Create Pages
        const pageSeeds = await readSeedFile<SeedPage[]>("pages.json");
        if (pageSeeds?.length) {
            for (const seed of pageSeeds) {
                const projectId = seed.project_id ? projectMap[seed.project_id] : undefined;

                await seedPage(seed, workspace.id, projectId, userId, null, labelMap);
            }
        }

        console.log(`[Seeder] Workspace seeding completed for ${workspaceId}`);

    } catch (error) {
        console.error(`[Seeder] Failed to seed workspace ${workspaceId}:`, error);
    }
}
