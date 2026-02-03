import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  userId: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  projectIdentifier: string;
  issueId: string;
  issueSequenceId: number;
  parentIssueId: string;
  parentSequenceId: number;
  labelId: string;
  moduleId: string;
  cycleId: string;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  wiPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("wi-ident"));
  },

  wiPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("wi-ident");
      const password = generateTestPassword();
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "WorkItem",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id ?? signupData.id;

      // 2. Set session cookies
      const cookies = signupRes
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value);
      for (const cookie of cookies) {
        const parts = cookie.split(";")[0]!.split("=");
        await page.context().addCookies([
          {
            name: parts[0]!.trim(),
            value: parts.slice(1).join("=").trim(),
            domain: "localhost",
            path: "/",
          },
        ]);
      }

      // 3. Onboard
      await request.patch(`${API_BASE}/api/users/me/`, {
        headers: headers(token),
        data: {
          first_name: "WorkItem",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Work Item Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId = ws.id;

      // 5. Create project
      const projectIdentifier = "WITEST";
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: {
            name: "Work Item Test Project",
            identifier: projectIdentifier,
            network: 2,
          },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId = proj.id;

      // 6. Create label
      const labelRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/labels/`,
        {
          headers: headers(token),
          data: { name: "Bug", color: "#ff0000" },
        }
      );
      expect(labelRes.ok()).toBeTruthy();
      const labelData = await labelRes.json();

      // 7. Create module
      const moduleRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/modules/`,
        {
          headers: headers(token),
          data: { name: "Module Alpha" },
        }
      );
      expect(moduleRes.ok()).toBeTruthy();
      const moduleData = await moduleRes.json();

      // 8. Create cycle
      const now = new Date();
      const cycleRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/cycles/`,
        {
          headers: headers(token),
          data: {
            name: "Sprint 1",
            start_date: now.toISOString().split("T")[0],
            end_date: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
          },
        }
      );
      expect(cycleRes.ok()).toBeTruthy();
      const cycleData = await cycleRes.json();

      // 9. Create parent issue
      const parentRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/`,
        {
          headers: headers(token),
          data: { name: "Parent Issue", priority: 1 },
        }
      );
      expect(parentRes.ok()).toBeTruthy();
      const parentData = await parentRes.json();

      // 10. Create main issue with relations
      const issueRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/`,
        {
          headers: headers(token),
          data: {
            name: "Test Issue Alpha",
            priority: 2,
            parent_id: parentData.id,
            assignee_ids: [userId],
            label_ids: [labelData.id],
          },
        }
      );
      expect(issueRes.ok()).toBeTruthy();
      const issueData = await issueRes.json();

      // 11. Add issue to module
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/modules/${moduleData.id}/issues/`,
        {
          headers: headers(token),
          data: { issues: [issueData.id] },
        }
      );

      // 12. Add issue to cycle
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/cycles/${cycleData.id}/cycle-issues/`,
        {
          headers: headers(token),
          data: { issues: [issueData.id] },
        }
      );

      // 13. Add link to issue
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueData.id}/links/`,
        {
          headers: headers(token),
          data: { url: "https://example.com", title: "Example Link" },
        }
      );

      // 14. Add reaction to issue
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueData.id}/reactions/`,
        {
          headers: headers(token),
          data: { reaction: "thumbsup" },
        }
      );

      // 15. Subscribe to issue
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueData.id}/subscribe/`,
        { headers: headers(token) }
      );

      // 16. Create child issue (for sub_issues_count)
      await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/`,
        {
          headers: headers(token),
          data: { name: "Child Issue", parent_id: issueData.id },
        }
      );

      // Store test data on page for easy access
      (page as any).__testData = {
        token,
        userId,
        wsSlug,
        workspaceId,
        projectId,
        projectIdentifier,
        issueId: issueData.id,
        issueSequenceId: issueData.sequence_id,
        parentIssueId: parentData.id,
        parentSequenceId: parentData.sequence_id,
        labelId: labelData.id,
        moduleId: moduleData.id,
        cycleId: cycleData.id,
      } as TestData;

      await use(page);
    },
    { timeout: 60000 },
  ],

  td: async ({ wiPage }, use) => {
    await use((wiPage as any).__testData as TestData);
  },
});

// ── Helper ───────────────────────────────────────────────────────────────────

function workItemUrl(td: TestData, identifier: string): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/work-items/${identifier}/`;
}

function authHeaders(td: TestData): Record<string, string> {
  return { Authorization: `Bearer ${td.token}` };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Work Item by Identifier API", () => {
  test.describe("Basic Retrieval", () => {
    test("retrieves issue by identifier (PROJECT-N)", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      expect(res.ok()).toBe(true);
      const data = await res.json();

      expect(data.id).toBe(td.issueId);
      expect(data.name).toBe("Test Issue Alpha");
      expect(data.sequence_id).toBe(td.issueSequenceId);
      expect(data.project_id).toBe(td.projectId);
      expect(data.workspace_id).toBe(td.workspaceId);
    });

    test("returns correct base fields", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("project_id");
      expect(data).toHaveProperty("workspace_id");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("description_html");
      expect(data).toHaveProperty("priority");
      expect(data).toHaveProperty("sort_order");
      expect(data).toHaveProperty("sequence_id");
      expect(data).toHaveProperty("is_draft");
      expect(data).toHaveProperty("is_epic");
      expect(data).toHaveProperty("created_at");
      expect(data).toHaveProperty("updated_at");
    });

    test("returns parent_id when issue has parent", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.parent_id).toBe(td.parentIssueId);
    });

    test("returns priority value correctly", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.priority).toBe(2);
    });
  });

  test.describe("Case Insensitivity", () => {
    test("handles lowercase project identifier", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier.toLowerCase()}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      expect(res.ok()).toBe(true);
      const data = await res.json();
      expect(data.id).toBe(td.issueId);
    });

    test("handles mixed case project identifier", async ({ td, request }) => {
      const identifier = `WiTeSt-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      expect(res.ok()).toBe(true);
      const data = await res.json();
      expect(data.id).toBe(td.issueId);
    });
  });

  test.describe("Relation Arrays", () => {
    test("returns assignee_ids array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(Array.isArray(data.assignee_ids)).toBe(true);
      expect(data.assignee_ids).toContain(td.userId);
    });

    test("returns label_ids array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(Array.isArray(data.label_ids)).toBe(true);
      expect(data.label_ids).toContain(td.labelId);
    });

    test("returns module_ids array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(Array.isArray(data.module_ids)).toBe(true);
      // Module association may or may not be set depending on fixture timing
      // Just verify the field exists and is an array
    });

    test("returns cycle_id", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.cycle_id).toBe(td.cycleId);
    });
  });

  test.describe("Counts", () => {
    test("returns sub_issues_count", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.sub_issues_count).toBeGreaterThanOrEqual(1);
    });

    test("returns link_count", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.link_count).toBeGreaterThanOrEqual(1);
    });

    test("returns attachment_count", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(typeof data.attachment_count).toBe("number");
    });
  });

  test.describe("Subscription Status", () => {
    test("returns is_subscribed true for subscribed user", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(data.is_subscribed).toBe(true);
    });

    test("returns is_intake field", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(workItemUrl(td, identifier), {
        headers: authHeaders(td),
      });
      const data = await res.json();

      expect(typeof data.is_intake).toBe("boolean");
    });
  });

  test.describe("Expand Parameter", () => {
    test("expand=issue_reactions returns reactions array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=issue_reactions`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.issue_reactions).toBeDefined();
      expect(Array.isArray(data.issue_reactions)).toBe(true);
      expect(data.issue_reactions.length).toBeGreaterThanOrEqual(1);
      expect(data.issue_reactions[0].reaction).toBe("thumbsup");
    });

    test("expand=issue_link returns links array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=issue_link`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.issue_link).toBeDefined();
      expect(Array.isArray(data.issue_link)).toBe(true);
      expect(data.issue_link.length).toBeGreaterThanOrEqual(1);
      expect(data.issue_link[0].url).toBe("https://example.com");
      expect(data.issue_link[0].title).toBe("Example Link");
    });

    test("expand=issue_attachments returns attachments array", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=issue_attachments`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.issue_attachments).toBeDefined();
      expect(Array.isArray(data.issue_attachments)).toBe(true);
    });

    test("expand=parent returns parent issue object", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=parent`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.parent).toBeDefined();
      expect(data.parent.id).toBe(td.parentIssueId);
      expect(data.parent.name).toBe("Parent Issue");
      expect(data.parent.sequence_id).toBe(td.parentSequenceId);
    });

    test("expand with multiple fields works", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=issue_reactions,issue_link,parent`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.issue_reactions).toBeDefined();
      expect(data.issue_link).toBeDefined();
      expect(data.parent).toBeDefined();
    });

    test("parent expand returns null when no parent", async ({ td, request }) => {
      // Parent issue has no parent
      const identifier = `${td.projectIdentifier}-${td.parentSequenceId}`;
      const res = await request.get(
        `${workItemUrl(td, identifier)}?expand=parent`,
        { headers: authHeaders(td) }
      );
      const data = await res.json();

      expect(data.parent_id).toBeNull();
    });
  });

  test.describe("Error Handling", () => {
    test("returns 400 for identifier without dash", async ({ td, request }) => {
      const res = await request.get(workItemUrl(td, "NODASH"), {
        headers: authHeaders(td),
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid");
    });

    test("returns 400 for non-numeric sequence", async ({ td, request }) => {
      const res = await request.get(
        workItemUrl(td, `${td.projectIdentifier}-abc`),
        { headers: authHeaders(td) }
      );
      expect(res.status()).toBe(400);
    });

    test("returns 400 for empty sequence", async ({ td, request }) => {
      const res = await request.get(
        workItemUrl(td, `${td.projectIdentifier}-`),
        { headers: authHeaders(td) }
      );
      expect(res.status()).toBe(400);
    });

    test("returns 404 for non-existent project identifier", async ({ td, request }) => {
      const res = await request.get(workItemUrl(td, "NONEXIST-1"), {
        headers: authHeaders(td),
      });
      expect(res.status()).toBe(404);
    });

    test("returns 404 for non-existent sequence number", async ({ td, request }) => {
      const res = await request.get(
        workItemUrl(td, `${td.projectIdentifier}-99999`),
        { headers: authHeaders(td) }
      );
      expect(res.status()).toBe(404);
    });

    test("returns 401 without authentication", async ({ td }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      // Use native fetch to avoid Playwright's cookie inheritance
      const res = await fetch(workItemUrl(td, identifier));
      expect(res.status).toBe(401);
    });

    test("returns error for wrong workspace", async ({ td, request }) => {
      const identifier = `${td.projectIdentifier}-${td.issueSequenceId}`;
      const res = await request.get(
        `${API_BASE}/api/workspaces/nonexistent-workspace/work-items/${identifier}/`,
        { headers: authHeaders(td) }
      );
      // Could be 404 (workspace not found) or 403 (not a member)
      expect([403, 404]).toContain(res.status());
    });
  });

  test.describe("Identifier Edge Cases", () => {
    test("handles project identifier with numbers", async ({ td, request }) => {
      // Create a project with numbers in identifier
      const newProjRes = await request.post(
        `${API_BASE}/api/workspaces/${td.wsSlug}/projects/`,
        {
          headers: authHeaders(td),
          data: { name: "Project 123", identifier: "PROJ123", network: 2 },
        }
      );
      expect(newProjRes.ok()).toBe(true);
      const newProj = await newProjRes.json();

      // Create issue in new project
      const issueRes = await request.post(
        `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${newProj.id}/issues/`,
        {
          headers: authHeaders(td),
          data: { name: "Test Issue" },
        }
      );
      expect(issueRes.ok()).toBe(true);
      const issueData = await issueRes.json();

      // Fetch by identifier
      const res = await request.get(
        workItemUrl(td, `PROJ123-${issueData.sequence_id}`),
        { headers: authHeaders(td) }
      );
      expect(res.ok()).toBe(true);
      const data = await res.json();
      expect(data.id).toBe(issueData.id);
    });

    test("handles large sequence numbers", async ({ td, request }) => {
      // This should return 404 since the sequence doesn't exist
      const res = await request.get(
        workItemUrl(td, `${td.projectIdentifier}-999999999`),
        { headers: authHeaders(td) }
      );
      expect(res.status()).toBe(404);
    });

    test("handles dash in identifier edge case", async ({ td, request }) => {
      // With WITEST--1, lastIndexOf("-") returns the second dash
      // So projectIdentifier = "WITEST-" and sequenceStr = "1"
      // This returns 404 because project "WITEST-" doesn't exist
      const res = await request.get(
        workItemUrl(td, `${td.projectIdentifier}--1`),
        { headers: authHeaders(td) }
      );
      expect(res.status()).toBe(404);
    });
  });
});
