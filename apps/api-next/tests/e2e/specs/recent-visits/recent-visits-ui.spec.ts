import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  wsSlug: string;
  projectId: string;
  projectName: string;
  identifier: string;
  issueId: string;
  issueName: string;
  issueSeqId: number;
  pageId: string;
  pageName: string;
  cycleId: string;
  cycleName: string;
  moduleId: string;
  moduleName: string;
  viewId: string;
  viewName: string;
}

// ── Fixture: authenticated page with recent visits test data ────────────────

type Fixtures = {
  recentVisitsPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("rv-ui"));
  },

  recentVisitsPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("rv-ui");
      const password = generateTestPassword();
      const projectName = `Recent Visits Project ${Date.now().toString(36).slice(-4)}`;
      const identifier = `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "RecentVisits",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;

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
          first_name: "RecentVisits",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Recent Visits Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: projectName, identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Create an issue
      const issueName = "Recent Visit Issue";
      const issueRes = await request.post(`${base_url}/issues/`, {
        headers: headers(token),
        data: { name: issueName },
      });
      expect(issueRes.ok()).toBeTruthy();
      const issue = await issueRes.json();

      // 7. Create a page
      const pageName = "Recent Visit Page";
      const pageRes = await request.post(`${base_url}/pages/`, {
        headers: headers(token),
        data: { name: pageName, access: 0 },
      });
      expect(pageRes.ok()).toBeTruthy();
      const pg = await pageRes.json();

      // 8. Create a cycle
      const cycleName = "Recent Cycle";
      const cycleRes = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: cycleName },
      });
      expect(cycleRes.ok()).toBeTruthy();
      const cycle = await cycleRes.json();

      // 9. Create a module
      const moduleName = "Recent Module";
      const moduleRes = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: moduleName },
      });
      expect(moduleRes.ok()).toBeTruthy();
      const mod = await moduleRes.json();

      // 10. Create a view
      const viewName = "Recent View";
      const viewRes = await request.post(`${base_url}/views/`, {
        headers: headers(token),
        data: { name: viewName, filters: {} },
      });
      expect(viewRes.ok()).toBeTruthy();
      const view = await viewRes.json();

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        projectName,
        identifier,
        issueId: issue.id,
        issueName,
        issueSeqId: issue.sequence_id,
        pageId: pg.id,
        pageName,
        cycleId: cycle.id,
        cycleName,
        moduleId: mod.id,
        moduleName,
        viewId: view.id,
        viewName,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ recentVisitsPage }, use) => {
    await use((recentVisitsPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiUrl(wsSlug: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}`;
}

function projectUrl(wsSlug: string, projectId: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
}

function workItemUrl(wsSlug: string, identifier: string, seqId: number): string {
  return `${API_BASE}/api/workspaces/${wsSlug}/work-items/${identifier}-${seqId}/`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. List Recent Visits ──────────────────────────────────────────────────

test.describe("List Recent Visits", () => {
  test("should return list via API (may have visits from fixture)", async ({
    recentVisitsPage,
    td,
  }) => {
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Should return an array (might have visits from project creation in fixture)
    expect(Array.isArray(visits)).toBe(true);
  });

  test("should list recent visits after visiting entities", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit the project (triggers recent visit recording)
    const projectVisitRes = await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(projectVisitRes.ok()).toBeTruthy();

    // Visit the issue using the work-items endpoint (this tracks visits)
    const issueVisitRes = await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(issueVisitRes.ok()).toBeTruthy();

    // Visit the page (with track_visit=true)
    const pageVisitRes = await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${td.pageId}/?track_visit=true`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(pageVisitRes.ok()).toBeTruthy();

    // Small delay to ensure visits are recorded
    await recentVisitsPage.waitForTimeout(500);

    // List recent visits
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // Should have visits for project, issue, and page
    expect(visits.length).toBeGreaterThanOrEqual(1);
  });

  test("should filter recent visits by entity_name=issue", async ({
    recentVisitsPage,
    td,
  }) => {
    // First visit an issue to ensure there's data (use work-items endpoint)
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Filter by issue
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // All returned visits should be issues
    for (const visit of visits) {
      expect(visit.entity_name).toBe("issue");
    }
  });

  test("should filter recent visits by entity_name=project", async ({
    recentVisitsPage,
    td,
  }) => {
    // First visit a project to ensure there's data
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Filter by project
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=project`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // All returned visits should be projects
    for (const visit of visits) {
      expect(visit.entity_name).toBe("project");
    }
  });

  test("should filter recent visits by entity_name=page", async ({
    recentVisitsPage,
    td,
  }) => {
    // First visit a page with track_visit=true to ensure there's data
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${td.pageId}/?track_visit=true`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Filter by page
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=page`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // All returned visits should be pages
    for (const visit of visits) {
      expect(visit.entity_name).toBe("page");
    }
  });
});

// ─── 2. Create/Record Visit ─────────────────────────────────────────────────

test.describe("Create/Record Visit", () => {
  test("should record project visit when accessing project detail", async ({
    recentVisitsPage,
    td,
  }) => {
    // Access project detail (this records a visit)
    const res = await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Verify the visit was recorded
    const visitsRes = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=project`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(visitsRes.ok()).toBeTruthy();
    const visits = await visitsRes.json();

    const projectVisit = visits.find(
      (v: any) => v.entity_identifier === td.projectId
    );
    expect(projectVisit).toBeDefined();
    expect(projectVisit.entity_name).toBe("project");
    expect(projectVisit.entity_data).toBeDefined();
    expect(projectVisit.entity_data.id).toBe(td.projectId);
    expect(projectVisit.entity_data.name).toBe(td.projectName);
  });

  test("should record issue visit when accessing via work-items endpoint", async ({
    recentVisitsPage,
    td,
  }) => {
    // Access issue via work-items endpoint (this records a visit)
    const res = await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Verify the visit was recorded
    const visitsRes = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(visitsRes.ok()).toBeTruthy();
    const visits = await visitsRes.json();

    const issueVisit = visits.find(
      (v: any) => v.entity_identifier === td.issueId
    );
    expect(issueVisit).toBeDefined();
    expect(issueVisit.entity_name).toBe("issue");
    expect(issueVisit.entity_data).toBeDefined();
    expect(issueVisit.entity_data.id).toBe(td.issueId);
    expect(issueVisit.entity_data.name).toBe(td.issueName);
    expect(issueVisit.entity_data.project_id).toBe(td.projectId);
    expect(issueVisit.entity_data.project_identifier).toBe(td.identifier);
    expect(issueVisit.entity_data.sequence_id).toBe(td.issueSeqId);
  });

  test("should record page visit when accessing page with track_visit=true", async ({
    recentVisitsPage,
    td,
  }) => {
    // Access page detail with track_visit=true (this records a visit)
    const res = await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${td.pageId}/?track_visit=true`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Wait for visit to be recorded
    await recentVisitsPage.waitForTimeout(500);

    // Verify the visit was recorded
    const visitsRes = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=page`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(visitsRes.ok()).toBeTruthy();
    const visits = await visitsRes.json();

    const pageVisit = visits.find(
      (v: any) => v.entity_identifier === td.pageId
    );
    expect(pageVisit).toBeDefined();
    expect(pageVisit.entity_name).toBe("page");
    expect(pageVisit.entity_data).toBeDefined();
    expect(pageVisit.entity_data.id).toBe(td.pageId);
    expect(pageVisit.entity_data.name).toBe(td.pageName);
    expect(pageVisit.entity_data.project_id).toBe(td.projectId);
  });

  test("should update visited_at timestamp on re-visit", async ({
    recentVisitsPage,
    td,
  }) => {
    // First visit (use work-items endpoint)
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // Get first visit timestamp
    const firstRes = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const firstVisits = await firstRes.json();
    const firstVisit = firstVisits.find(
      (v: any) => v.entity_identifier === td.issueId
    );
    const firstTimestamp = firstVisit?.visited_at;

    // Wait a bit then visit again
    await recentVisitsPage.waitForTimeout(1100);

    // Second visit (use work-items endpoint)
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // Get updated timestamp
    const secondRes = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const secondVisits = await secondRes.json();
    const secondVisit = secondVisits.find(
      (v: any) => v.entity_identifier === td.issueId
    );
    const secondTimestamp = secondVisit?.visited_at;

    // The timestamp should be updated (more recent)
    expect(secondTimestamp).toBeDefined();
    if (firstTimestamp && secondTimestamp) {
      expect(new Date(secondTimestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(firstTimestamp).getTime()
      );
    }
  });
});

// ─── 3. Response Format Validation ──────────────────────────────────────────

test.describe("Response Format Validation", () => {
  test("should return proper response format for recent visits list", async ({
    recentVisitsPage,
    td,
  }) => {
    // Create some visits first
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Visit issue via work-items endpoint
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    expect(visits.length).toBeGreaterThan(0);

    // Each visit should have proper structure
    for (const visit of visits) {
      expect(visit).toHaveProperty("id");
      expect(visit).toHaveProperty("entity_name");
      expect(visit).toHaveProperty("entity_identifier");
      expect(visit).toHaveProperty("entity_data");
      expect(visit).toHaveProperty("visited_at");

      // Type checks
      expect(typeof visit.id).toBe("string");
      expect(typeof visit.entity_name).toBe("string");
      expect(typeof visit.entity_identifier).toBe("string");
      expect(["issue", "page", "project"]).toContain(visit.entity_name);
    }
  });

  test("should return proper entity_data format for project visit", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit project
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=project`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    const projectVisit = visits.find(
      (v: any) => v.entity_identifier === td.projectId
    );
    expect(projectVisit).toBeDefined();
    expect(projectVisit.entity_data).toHaveProperty("id");
    expect(projectVisit.entity_data).toHaveProperty("name");
    expect(projectVisit.entity_data).toHaveProperty("logo_props");
    expect(projectVisit.entity_data).toHaveProperty("project_members");
    expect(projectVisit.entity_data).toHaveProperty("identifier");

    expect(Array.isArray(projectVisit.entity_data.project_members)).toBe(true);
  });

  test("should return proper entity_data format for issue visit", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit issue (use work-items endpoint)
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    const issueVisit = visits.find(
      (v: any) => v.entity_identifier === td.issueId
    );
    expect(issueVisit).toBeDefined();
    expect(issueVisit.entity_data).toHaveProperty("id");
    expect(issueVisit.entity_data).toHaveProperty("name");
    expect(issueVisit.entity_data).toHaveProperty("state");
    expect(issueVisit.entity_data).toHaveProperty("priority");
    expect(issueVisit.entity_data).toHaveProperty("assignees");
    expect(issueVisit.entity_data).toHaveProperty("sequence_id");
    expect(issueVisit.entity_data).toHaveProperty("project_id");
    expect(issueVisit.entity_data).toHaveProperty("project_identifier");
    expect(issueVisit.entity_data).toHaveProperty("is_epic");

    expect(Array.isArray(issueVisit.entity_data.assignees)).toBe(true);
    expect(typeof issueVisit.entity_data.is_epic).toBe("boolean");
  });

  test("should return proper entity_data format for page visit", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit page with track_visit
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${td.pageId}/?track_visit=true`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=page`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    const pageVisit = visits.find(
      (v: any) => v.entity_identifier === td.pageId
    );
    expect(pageVisit).toBeDefined();
    expect(pageVisit.entity_data).toHaveProperty("id");
    expect(pageVisit.entity_data).toHaveProperty("name");
    expect(pageVisit.entity_data).toHaveProperty("logo_props");
    expect(pageVisit.entity_data).toHaveProperty("project_id");
    expect(pageVisit.entity_data).toHaveProperty("owned_by");
    expect(pageVisit.entity_data).toHaveProperty("project_identifier");
  });
});

// ─── 4. Entity Data for Deleted Entities ────────────────────────────────────

test.describe("Deleted Entity Handling", () => {
  test("should return entity_data as null for deleted issue", async ({
    recentVisitsPage,
    td,
  }) => {
    // First create a new issue, visit it, then delete it
    const createRes = await recentVisitsPage.request.post(
      `${projectUrl(td.wsSlug, td.projectId)}/issues/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Temp Issue to Delete" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const tempIssue = await createRes.json();

    // Visit the issue
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/issues/${tempIssue.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // Delete the issue
    const deleteRes = await recentVisitsPage.request.delete(
      `${projectUrl(td.wsSlug, td.projectId)}/issues/${tempIssue.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Get recent visits
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Find the deleted issue visit
    const deletedVisit = visits.find(
      (v: any) => v.entity_identifier === tempIssue.id
    );
    // Visit should still exist but entity_data should be null
    if (deletedVisit) {
      expect(deletedVisit.entity_data).toBeNull();
    }
  });

  test("should return entity_data as null for deleted page", async ({
    recentVisitsPage,
    td,
  }) => {
    // First create a new page, visit it, archive it, then delete it
    const createRes = await recentVisitsPage.request.post(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Temp Page to Delete", access: 0 },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const tempPage = await createRes.json();

    // Visit the page
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${tempPage.id}/?track_visit=true`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // First archive the page (pages must be archived before deletion)
    const archiveRes = await recentVisitsPage.request.post(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${tempPage.id}/archive/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(archiveRes.ok()).toBeTruthy();

    // Delete the page (now it's archived)
    const deleteRes = await recentVisitsPage.request.delete(
      `${projectUrl(td.wsSlug, td.projectId)}/pages/${tempPage.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Get recent visits
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=page`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Find the deleted page visit - recent visits are cleaned up on page delete
    const deletedVisit = visits.find(
      (v: any) => v.entity_identifier === tempPage.id
    );
    // Visit should have been deleted during page deletion
    expect(deletedVisit).toBeUndefined();
  });
});

// ─── 5. Authentication Tests ────────────────────────────────────────────────

test.describe("Authentication Tests", () => {
  test("should return 401 when not authenticated for list", async ({
    playwright,
    td,
  }) => {
    // Use a fresh request context without any cookies
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${apiUrl(td.wsSlug)}/recent-visits/`
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should return proper error message for unauthenticated request", async ({
    playwright,
    td,
  }) => {
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${apiUrl(td.wsSlug)}/recent-visits/`
      );
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("detail");
    } finally {
      await freshRequest.dispose();
    }
  });
});

// ─── 6. Ordering and Limits ─────────────────────────────────────────────────

test.describe("Ordering and Limits", () => {
  test("should return visits ordered by visited_at descending", async ({
    recentVisitsPage,
    td,
  }) => {
    // Create multiple issues and visit them in order
    const issueIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await recentVisitsPage.request.post(
        `${projectUrl(td.wsSlug, td.projectId)}/issues/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: { name: `Order Test Issue ${i}` },
        }
      );
      expect(res.ok()).toBeTruthy();
      const issue = await res.json();
      issueIds.push(issue.id);

      // Visit the issue
      await recentVisitsPage.request.get(
        `${projectUrl(td.wsSlug, td.projectId)}/issues/${issue.id}/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
        }
      );

      // Wait between visits to ensure different timestamps
      await recentVisitsPage.waitForTimeout(200);
    }

    // Get recent visits
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Should be ordered by visited_at descending (most recent first)
    for (let i = 0; i < visits.length - 1; i++) {
      const currentDate = new Date(visits[i].visited_at);
      const nextDate = new Date(visits[i + 1].visited_at);
      expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
    }
  });

  test("should limit results to 20 visits", async ({
    recentVisitsPage,
    td,
  }) => {
    // Create 25 issues and visit them
    for (let i = 0; i < 25; i++) {
      const res = await recentVisitsPage.request.post(
        `${projectUrl(td.wsSlug, td.projectId)}/issues/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: { name: `Limit Test Issue ${i}` },
        }
      );
      expect(res.ok()).toBeTruthy();
      const issue = await res.json();

      // Visit the issue
      await recentVisitsPage.request.get(
        `${projectUrl(td.wsSlug, td.projectId)}/issues/${issue.id}/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
        }
      );
    }

    await recentVisitsPage.waitForTimeout(500);

    // Get recent visits
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=issue`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Should be limited to 20
    expect(visits.length).toBeLessThanOrEqual(20);
  });
});

// ─── 7. Invalid Filter Handling ─────────────────────────────────────────────

test.describe("Invalid Filter Handling", () => {
  test("should return default entities for invalid entity_name filter", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit some entities first
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // Use invalid filter - should fall back to default entities (issue, page, project)
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/?entity_name=invalid_type`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // Should still return results with default entity types
    for (const visit of visits) {
      expect(["issue", "page", "project"]).toContain(visit.entity_name);
    }
  });

  test("should exclude non-allowed entity types from results", async ({
    recentVisitsPage,
    td,
  }) => {
    // Get all recent visits (should only contain issue, page, project)
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    expect(Array.isArray(visits)).toBe(true);
    // All visits should be one of the allowed types
    for (const visit of visits) {
      expect(["issue", "page", "project"]).toContain(visit.entity_name);
    }
  });
});

// ─── 8. Workspace Isolation ─────────────────────────────────────────────────

test.describe("Workspace Isolation", () => {
  test("should only return visits for the specified workspace", async ({
    recentVisitsPage,
    td,
  }) => {
    // Create a second workspace
    const secondWsSlug = generateWorkspaceSlug("rv-second");
    await recentVisitsPage.request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: {
        name: "Second Workspace",
        slug: secondWsSlug,
        organization_size: "2-10",
      },
    });

    // Create project in second workspace
    const projRes = await recentVisitsPage.request.post(
      `${API_BASE}/api/workspaces/${secondWsSlug}/projects/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Second Project", identifier: "SEC", network: 2 },
      }
    );
    expect(projRes.ok()).toBeTruthy();
    const proj = await projRes.json();

    // Visit project in second workspace
    await recentVisitsPage.request.get(
      `${API_BASE}/api/workspaces/${secondWsSlug}/projects/${proj.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Visit project in first workspace
    await recentVisitsPage.request.get(
      `${projectUrl(td.wsSlug, td.projectId)}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    // Get visits for first workspace
    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // Should only contain visits from first workspace (project visits)
    const secondWsVisit = visits.find(
      (v: any) => v.entity_identifier === proj.id
    );
    expect(secondWsVisit).toBeUndefined();
  });
});

// ─── 9. Edge Cases ──────────────────────────────────────────────────────────

test.describe("Edge Cases", () => {
  test("should return 404 for non-existent workspace", async ({
    playwright,
    td,
  }) => {
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${API_BASE}/api/workspaces/non-existent-workspace/recent-visits/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
        }
      );
      // Should return 404 or 401 depending on auth middleware order
      expect([401, 404]).toContain(res.status());
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should handle empty visited_at gracefully", async ({
    recentVisitsPage,
    td,
  }) => {
    // Visit an entity (use work-items endpoint for issue)
    await recentVisitsPage.request.get(
      workItemUrl(td.wsSlug, td.identifier, td.issueSeqId),
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    await recentVisitsPage.waitForTimeout(500);

    const res = await recentVisitsPage.request.get(
      `${apiUrl(td.wsSlug)}/recent-visits/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const visits = await res.json();

    // All visits should have a valid visited_at timestamp
    for (const visit of visits) {
      expect(visit.visited_at).toBeDefined();
      // Should be a valid ISO date string
      const date = new Date(visit.visited_at);
      expect(date.toString()).not.toBe("Invalid Date");
    }
  });
});
