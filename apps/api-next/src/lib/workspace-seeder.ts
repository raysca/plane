
import { db } from "../db";
import { users, userProfiles } from "../db/schema/user";
import {
    workspaces,
    workspaceMembers,
    workspaceHomePreferences,
    workspaceUserPreferences,
    quickLinks,
    stickies,
    recentVisits,
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
type SeedUser = {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    display_name: string;
    username: string;
    role: string;
    workspace_role: number;
    project_role: number;
};

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
    assignee_ids?: number[];
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

        // 1. Create Seed Users
        const userSeeds = await readSeedFile<SeedUser[]>("users.json");
        const userMap: Record<number, string> = {};

        if (userSeeds?.length) {
            for (const seed of userSeeds) {
                const existingUser = await db.query.users.findFirst({
                    where: eq(users.email, seed.email),
                });

                let seedUserId: string;

                if (existingUser) {
                    seedUserId = existingUser.id;
                    console.log(`[Seeder] User ${seed.email} already exists, reusing`);
                } else {
                    const [newUser] = await db.insert(users).values({
                        email: seed.email,
                        emailVerified: true,
                        name: seed.display_name,
                        firstName: seed.first_name,
                        lastName: seed.last_name,
                        displayName: seed.display_name,
                        username: seed.username,
                        isActive: true,
                    }).returning();

                    if (!newUser) continue;
                    seedUserId = newUser.id;

                    // Create user profile
                    await db.insert(userProfiles).values({
                        userId: seedUserId,
                        isOnboarded: true,
                        role: seed.role,
                    });

                    console.log(`[Seeder] Created user ${seed.display_name} (${seed.email})`);
                }

                userMap[seed.id] = seedUserId;

                // Add as workspace member (skip if already a member)
                const existingWsMember = await db.query.workspaceMembers.findFirst({
                    where: (wm, { and, eq: e }) =>
                        and(e(wm.workspaceId, workspace.id), e(wm.userId, seedUserId)),
                });

                if (!existingWsMember) {
                    await db.insert(workspaceMembers).values({
                        workspaceId: workspace.id,
                        userId: seedUserId,
                        role: seed.workspace_role,
                    });
                }
            }
        }

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

            // Add calling user as admin member
            await db.insert(projectMembers).values({
                projectId: newProject.id,
                memberId: userId,
                role: 20, // Admin
            });

            // Add seed users as project members
            if (userSeeds?.length) {
                for (const userSeed of userSeeds) {
                    const seedUserId = userMap[userSeed.id];
                    if (!seedUserId || seedUserId === userId) continue;

                    await db.insert(projectMembers).values({
                        projectId: newProject.id,
                        memberId: seedUserId,
                        role: userSeed.project_role,
                    });
                }
            }
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

                // Issue Assignees
                if (seed.assignee_ids && seed.assignee_ids.length) {
                    for (const assigneeId of seed.assignee_ids) {
                        const mappedUserId = userMap[assigneeId];
                        if (mappedUserId) {
                            await db.insert(issueAssignees).values({
                                issueId: newIssue.id,
                                assigneeId: mappedUserId,
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

        // 10. Create Home Widget Preferences
        const homeWidgetKeys = ["quick_links", "recents", "my_stickies"];
        const existingHomePrefs = await db.query.workspaceHomePreferences.findMany({
            where: (hp, { and, eq: e }) =>
                and(e(hp.workspaceId, workspace.id), e(hp.userId, userId)),
        });
        const existingHomeKeys = existingHomePrefs.map((p) => p.key);
        const missingHomeKeys = homeWidgetKeys.filter((k) => !existingHomeKeys.includes(k));

        if (missingHomeKeys.length > 0) {
            await db.insert(workspaceHomePreferences).values(
                missingHomeKeys.map((key, i) => ({
                    workspaceId: workspace.id,
                    userId,
                    key,
                    isEnabled: true,
                    sortOrder: 1000 - (i + 1),
                }))
            );
            console.log(`[Seeder] Created ${missingHomeKeys.length} home widget preferences`);
        }

        // 11. Create Sidebar Preferences
        const sidebarKeys = ["views", "active_cycles", "analytics", "drafts", "your_work", "archives", "stickies"];
        const defaultPinnedKeys = ["drafts", "your_work", "stickies"];
        const existingSidebarPrefs = await db.query.workspaceUserPreferences.findMany({
            where: (sp, { and, eq: e }) =>
                and(e(sp.workspaceId, workspace.id), e(sp.userId, userId)),
        });
        const existingSidebarKeys = existingSidebarPrefs.map((p) => p.key);
        const missingSidebarKeys = sidebarKeys.filter((k) => !existingSidebarKeys.includes(k));

        if (missingSidebarKeys.length > 0) {
            await db.insert(workspaceUserPreferences).values(
                missingSidebarKeys.map((key, i) => ({
                    workspaceId: workspace.id,
                    userId,
                    key,
                    isPinned: defaultPinnedKeys.includes(key),
                    sortOrder: 65535 + (i * 10000),
                }))
            );
            console.log(`[Seeder] Created ${missingSidebarKeys.length} sidebar preferences`);
        }

        // 12. Create Quick Links
        const existingLinks = await db.query.quickLinks.findMany({
            where: (ql, { and, eq: e }) =>
                and(e(ql.workspaceId, workspace.id), e(ql.userId, userId)),
        });

        if (existingLinks.length === 0) {
            const seedLinks = [
                { name: "Plane Docs", url: "https://docs.plane.so", description: "Official Plane documentation" },
                { name: "GitHub Repo", url: "https://github.com/makeplane/plane", description: "Plane source code on GitHub" },
                { name: "Plane Community", url: "https://discord.com/invite/A92xrEGCge", description: "Join the Plane Discord community" },
            ];

            await db.insert(quickLinks).values(
                seedLinks.map((link, i) => ({
                    workspaceId: workspace.id,
                    userId,
                    name: link.name,
                    url: link.url,
                    description: link.description,
                    sortOrder: (i + 1) * 10000,
                }))
            );
            console.log(`[Seeder] Created ${seedLinks.length} quick links`);
        }

        // 13. Create Stickies
        const existingStickies = await db.query.stickies.findMany({
            where: (s, { and, eq: e }) =>
                and(e(s.workspaceId, workspace.id), e(s.userId, userId)),
        });

        if (existingStickies.length === 0) {
            const seedStickies = [
                {
                    name: "Welcome to Plane!",
                    descriptionHtml: "<p>This is your workspace sticky note. Use stickies to jot down quick thoughts, reminders, or ideas.</p>",
                    descriptionStripped: "This is your workspace sticky note. Use stickies to jot down quick thoughts, reminders, or ideas.",
                    color: "#FEF3C7",
                },
                {
                    name: "Sprint Goals",
                    descriptionHtml: "<p>Track your sprint goals here:</p><ul><li>Complete onboarding flow</li><li>Ship dashboard improvements</li><li>Review pending PRs</li></ul>",
                    descriptionStripped: "Track your sprint goals here: Complete onboarding flow, Ship dashboard improvements, Review pending PRs",
                    color: "#DBEAFE",
                },
            ];

            await db.insert(stickies).values(
                seedStickies.map((sticky, i) => ({
                    workspaceId: workspace.id,
                    userId,
                    name: sticky.name,
                    descriptionHtml: sticky.descriptionHtml,
                    descriptionStripped: sticky.descriptionStripped,
                    color: sticky.color,
                    sortOrder: (i + 1) * 10000,
                }))
            );
            console.log(`[Seeder] Created ${seedStickies.length} stickies`);
        }

        // 14. Create Recent Visits (for projects and some issues)
        const existingVisits = await db.query.recentVisits.findMany({
            where: (rv, { and, eq: e }) =>
                and(e(rv.workspaceId, workspace.id), e(rv.userId, userId)),
        });

        if (existingVisits.length === 0) {
            const visitEntries: Array<{ entityType: string; entityId: string }> = [];

            // Add project visits
            for (const [, projectId] of Object.entries(projectMap)) {
                visitEntries.push({ entityType: "project", entityId: projectId });
            }

            // Add some issue visits (first 3 issues)
            const recentIssues = await db.query.issues.findMany({
                where: eq(issues.workspaceId, workspace.id),
                limit: 3,
            });
            for (const issue of recentIssues) {
                visitEntries.push({ entityType: "issue", entityId: issue.id });
            }

            if (visitEntries.length > 0) {
                const now = Date.now();
                await db.insert(recentVisits).values(
                    visitEntries.map((entry, i) => ({
                        workspaceId: workspace.id,
                        userId,
                        entityType: entry.entityType,
                        entityId: entry.entityId,
                        visitedAt: new Date(now - i * 60000), // Stagger by 1 minute each
                    }))
                );
                console.log(`[Seeder] Created ${visitEntries.length} recent visits`);
            }
        }

        console.log(`[Seeder] Workspace seeding completed for ${workspaceId}`);

    } catch (error) {
        console.error(`[Seeder] Failed to seed workspace ${workspaceId}:`, error);
    }
}
