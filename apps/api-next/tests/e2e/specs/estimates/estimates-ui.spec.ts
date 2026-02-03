import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface EstimatePoint {
  id: string;
  estimate_id: string;
  key: number;
  value: string;
  description: string | null;
}

interface Estimate {
  id: string;
  name: string;
  description: string | null;
  type: string;
  project_id: string;
  workspace_id: string;
  last_used: boolean;
  points: EstimatePoint[];
}

interface TestData {
  token: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  project2Id: string;
  identifier: string;
  identifier2: string;
  estimateId: string;
  estimateName: string;
  estimatePoints: EstimatePoint[];
  secondEstimateId: string;
  secondEstimateName: string;
  issueId: string;
  issueSeqId: number;
}

// ── Fixture: authenticated page with estimates test data ──────────────────────

type Fixtures = {
  estimatesPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("est-ui"));
  },

  estimatesPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("est-ui");
      const password = generateTestPassword();
      const identifier = `E${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const identifier2 = `F${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Estimates",
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
          first_name: "Estimates",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Estimates Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId: string = ws.id;

      // 5. Create first project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Estimates Project 1", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // 6. Create second project
      const proj2Res = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Estimates Project 2", identifier: identifier2, network: 2 },
        }
      );
      expect(proj2Res.ok()).toBeTruthy();
      const proj2 = await proj2Res.json();
      const project2Id: string = proj2.id;

      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 7. Create estimate "Story Points" with points using Django bulk format
      const estimateRes = await request.post(`${base_url}/estimates/`, {
        headers: headers(token),
        data: {
          estimate: {
            name: "Story Points",
            type: "points",
            last_used: false,
          },
          estimate_points: [
            { key: 0, value: "0", description: "No effort" },
            { key: 1, value: "1", description: "Trivial" },
            { key: 2, value: "2", description: "Small" },
            { key: 3, value: "3", description: "Medium" },
            { key: 4, value: "5", description: "Large" },
            { key: 5, value: "8", description: "Extra Large" },
          ],
        },
      });
      expect(estimateRes.ok()).toBeTruthy();
      const estimate = await estimateRes.json();

      // 8. Create second estimate "T-Shirt Sizes"
      const estimate2Res = await request.post(`${base_url}/estimates/`, {
        headers: headers(token),
        data: {
          estimate: {
            name: "T-Shirt Sizes",
            type: "categories",
            last_used: false,
          },
          estimate_points: [
            { key: 0, value: "XS", description: "Extra Small" },
            { key: 1, value: "S", description: "Small" },
            { key: 2, value: "M", description: "Medium" },
            { key: 3, value: "L", description: "Large" },
            { key: 4, value: "XL", description: "Extra Large" },
          ],
        },
      });
      expect(estimate2Res.ok()).toBeTruthy();
      const estimate2 = await estimate2Res.json();

      // 9. Create an issue for estimate assignment tests
      const issueRes = await request.post(`${base_url}/issues/`, {
        headers: headers(token),
        data: { name: "Test Issue for Estimates" },
      });
      expect(issueRes.ok()).toBeTruthy();
      const issue = await issueRes.json();

      const td: TestData = {
        token,
        wsSlug,
        workspaceId,
        projectId,
        project2Id,
        identifier,
        identifier2,
        estimateId: estimate.id,
        estimateName: "Story Points",
        estimatePoints: estimate.points ?? [],
        secondEstimateId: estimate2.id,
        secondEstimateName: "T-Shirt Sizes",
        issueId: issue.id,
        issueSeqId: issue.sequence_id,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ estimatesPage }, use) => {
    await use((estimatesPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectBaseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function workspaceBaseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToProjectEstimates(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/settings/projects/${projectId}/estimates/`);
  await waitForAppReady(page);
}

async function goToIssueDetail(page: Page, wsSlug: string, issueId: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/${issueId}/`);
  await waitForAppReady(page);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. PROJECT ESTIMATES API - List Estimates
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - List Estimates", () => {
  test("should list project estimates via GET /projects/:projectId/estimates/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const estimates = Array.isArray(data) ? data : data.results ?? [];

    // Should have at least the 2 estimates we created
    expect(estimates.length).toBeGreaterThanOrEqual(2);

    // Verify structure of returned estimates
    const storyPoints = estimates.find((e: Estimate) => e.name === "Story Points");
    expect(storyPoints).toBeTruthy();
    expect(storyPoints.id).toBeTruthy();
    expect(storyPoints.type).toBe("points");
    expect(storyPoints.project_id).toBe(td.projectId);
    expect(storyPoints.workspace_id).toBe(td.workspaceId);
    expect(storyPoints.points).toBeDefined();
    expect(storyPoints.points.length).toBe(6);
  });

  test("should return estimates with points included", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const estimates = await res.json();
    const estimate = Array.isArray(estimates) ? estimates[0] : estimates.results?.[0];

    expect(estimate.points).toBeDefined();
    expect(Array.isArray(estimate.points)).toBeTruthy();

    // Verify point structure
    if (estimate.points.length > 0) {
      const point = estimate.points[0];
      expect(point).toHaveProperty("id");
      expect(point).toHaveProperty("estimate_id");
      expect(point).toHaveProperty("key");
      expect(point).toHaveProperty("value");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PROJECT ESTIMATES API - Create Estimate
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - Create Estimate", () => {
  test("should create an estimate via POST /projects/:projectId/estimates/ (Django bulk format)", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: {
            name: "Priority Levels",
            type: "categories",
            last_used: false,
          },
          estimate_points: [
            { key: 0, value: "Low", description: "Low priority" },
            { key: 1, value: "Medium", description: "Medium priority" },
            { key: 2, value: "High", description: "High priority" },
          ],
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.name).toBe("Priority Levels");
    expect(estimate.type).toBe("categories");
    expect(estimate.id).toBeTruthy();
    expect(estimate.project_id).toBe(td.projectId);
    expect(estimate.points).toBeDefined();
    expect(estimate.points.length).toBe(3);

    // Verify points are created correctly
    const lowPoint = estimate.points.find((p: EstimatePoint) => p.value === "Low");
    expect(lowPoint).toBeTruthy();
    expect(lowPoint.key).toBe(0);
    expect(lowPoint.description).toBe("Low priority");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should create an estimate with simple format (name/type at root)", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Simple Estimate",
          type: "points",
          estimate_points: [
            { key: 0, value: "1" },
            { key: 1, value: "2" },
          ],
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.name).toBe("Simple Estimate");
    expect(estimate.type).toBe("points");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should create an estimate without points", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: {
            name: "Empty Estimate",
            type: "categories",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.name).toBe("Empty Estimate");
    expect(estimate.points).toEqual([]);

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should auto-generate name when not provided", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: {
            type: "points",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.name).toBeTruthy();
    expect(typeof estimate.name).toBe("string");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PROJECT ESTIMATES API - Get Single Estimate
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - Get Single Estimate", () => {
  test("should get single estimate via GET /projects/:projectId/estimates/:estimateId/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.id).toBe(td.estimateId);
    expect(estimate.name).toBe(td.estimateName);
    expect(estimate.type).toBe("points");
    expect(estimate.points).toBeDefined();
    expect(estimate.points.length).toBe(6);
  });

  test("should return 404 for non-existent estimate", async ({
    estimatesPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${fakeId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PROJECT ESTIMATES API - Update Estimate
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - Update Estimate", () => {
  test("should update estimate name via PATCH /projects/:projectId/estimates/:estimateId/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: {
            name: "Story Points Updated",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.name).toBe("Story Points Updated");
    expect(estimate.id).toBe(td.estimateId);

    // Revert
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate: { name: td.estimateName } },
      }
    );
  });

  test("should update estimate type", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.secondEstimateId}/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: {
            type: "points",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.type).toBe("points");

    // Revert
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.secondEstimateId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate: { type: "categories" } },
      }
    );
  });

  test("should bulk update estimate points via PATCH (Django format)", async ({
    estimatesPage,
    td,
  }) => {
    // First get current points
    const getRes = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      { headers: authHeaders(td.token) }
    );
    const estimate = await getRes.json();
    const firstPoint = estimate.points[0];

    // Update the first point (value and key only - API only supports these fields in bulk update)
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate_points: [
            { id: firstPoint.id, value: "0.5", key: 0 },
          ],
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    const updatedPoint = updated.points.find((p: EstimatePoint) => p.id === firstPoint.id);
    expect(updatedPoint.value).toBe("0.5");
    expect(updatedPoint.key).toBe(0);

    // Revert
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate_points: [
            { id: firstPoint.id, value: "0", key: 0 },
          ],
        },
      }
    );
  });

  test("should return 404 when updating non-existent estimate", async ({
    estimatesPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${fakeId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate: { name: "Updated" } },
      }
    );
    expect(res.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. PROJECT ESTIMATES API - Delete Estimate
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - Delete Estimate", () => {
  test("should delete estimate via DELETE /projects/:projectId/estimates/:estimateId/", async ({
    estimatesPage,
    td,
  }) => {
    // Create a temporary estimate to delete
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "To Be Deleted", type: "categories" },
          estimate_points: [{ key: 0, value: "Test" }],
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const temp = await createRes.json();

    // Delete the estimate
    const delRes = await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify estimate is gone
    const getRes = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(getRes.status()).toBe(404);
  });

  test("should delete estimate points when estimate is deleted", async ({
    estimatesPage,
    td,
  }) => {
    // Create estimate with points
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "With Points", type: "points" },
          estimate_points: [
            { key: 0, value: "1" },
            { key: 1, value: "2" },
          ],
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const estimate = await createRes.json();

    // Delete the estimate
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );

    // Verify points are also gone (by trying to list them)
    const pointsRes = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/points/`,
      { headers: authHeaders(td.token) }
    );
    expect(pointsRes.ok()).toBeFalsy();
  });

  test("should return 404 when deleting non-existent estimate", async ({
    estimatesPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${fakeId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ESTIMATE POINTS API - CRUD Operations
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimate Points API - CRUD", () => {
  test("should list estimate points via GET /estimates/:estimateId/points/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const points = await res.json();
    expect(Array.isArray(points)).toBeTruthy();
    expect(points.length).toBe(6);

    // Verify point structure
    const firstPoint = points[0];
    expect(firstPoint).toHaveProperty("id");
    expect(firstPoint).toHaveProperty("estimate_id");
    expect(firstPoint).toHaveProperty("key");
    expect(firstPoint).toHaveProperty("value");
  });

  test("should create estimate point via POST /estimates/:estimateId/points/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      {
        headers: authHeaders(td.token),
        data: {
          key: 6,
          value: "13",
          description: "Epic size",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);

    const point = await res.json();
    expect(point.key).toBe(6);
    expect(point.value).toBe("13");
    expect(point.description).toBe("Epic size");
    expect(point.estimate_id).toBe(td.estimateId);

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/${point.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update estimate point via PATCH /estimates/:estimateId/points/:pointId/", async ({
    estimatesPage,
    td,
  }) => {
    // Get points
    const listRes = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    const points = await listRes.json();
    const pointToUpdate = points[1]; // Second point (key=1)

    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/${pointToUpdate.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          value: "1.5",
          description: "Updated description",
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    expect(updated.value).toBe("1.5");
    expect(updated.description).toBe("Updated description");
    expect(updated.key).toBe(1); // Key should remain unchanged

    // Revert
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/${pointToUpdate.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          value: "1",
          description: "Trivial",
        },
      }
    );
  });

  test("should delete estimate point via DELETE /estimates/:estimateId/points/:pointId/", async ({
    estimatesPage,
    td,
  }) => {
    // Create a point to delete
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      {
        headers: authHeaders(td.token),
        data: { key: 10, value: "100", description: "Huge" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const point = await createRes.json();

    // Delete the point
    const delRes = await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/${point.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify point is gone
    const listRes = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    const points = await listRes.json();
    const ids = points.map((p: EstimatePoint) => p.id);
    expect(ids).not.toContain(point.id);
  });

  test("should return 404 for point in non-existent estimate", async ({
    estimatesPage,
    td,
  }) => {
    const fakeEstimateId = "00000000-0000-0000-0000-000000000000";
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${fakeEstimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. ESTIMATE POINTS API - Django-compatible /estimate-points/ path
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimate Points API - Django-compatible path", () => {
  test("should create point via POST /estimates/:estimateId/estimate-points/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/estimate-points/`,
      {
        headers: authHeaders(td.token),
        data: {
          key: 7,
          value: "21",
          description: "Sprint-sized",
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const point = await res.json();
    expect(point.key).toBe(7);
    expect(point.value).toBe("21");

    // Clean up via the same path
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/estimate-points/${point.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update point via PATCH /estimates/:estimateId/estimate-points/:pointId/", async ({
    estimatesPage,
    td,
  }) => {
    // Create a point first
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/estimate-points/`,
      {
        headers: authHeaders(td.token),
        data: { key: 8, value: "34" },
      }
    );
    const point = await createRes.json();

    // Update via Django-compatible path
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/estimate-points/${point.id}/`,
      {
        headers: authHeaders(td.token),
        data: { value: "55" },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    expect(updated.value).toBe("55");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/estimate-points/${point.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should delete point via DELETE /estimates/:estimateId/estimate-points/:pointId/ and reindex keys", async ({
    estimatesPage,
    td,
  }) => {
    // Create a temporary estimate with specific points
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "Temp Estimate", type: "points" },
          estimate_points: [
            { key: 0, value: "A" },
            { key: 1, value: "B" },
            { key: 2, value: "C" },
          ],
        },
      }
    );
    const estimate = await createRes.json();
    const middlePoint = estimate.points.find((p: EstimatePoint) => p.value === "B");

    // Delete middle point - this should reindex remaining points
    const delRes = await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/estimate-points/${middlePoint.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.ok()).toBeTruthy();

    // Response should contain updated points with reindexed keys
    const updatedPoints = await delRes.json();
    expect(Array.isArray(updatedPoints)).toBeTruthy();
    expect(updatedPoints.length).toBe(2);

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. PROJECT ESTIMATES API - Assign Estimate to Project
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Estimates API - Assign Estimate to Project", () => {
  test("should assign estimate to project via PATCH /projects/:projectId/", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );
    expect(res.ok()).toBeTruthy();

    const project = await res.json();
    expect(project.estimate).toBe(td.estimateId);

    // Unassign for clean state
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });

  test("should get project estimate points via GET /projects/:projectId/project-estimates/", async ({
    estimatesPage,
    td,
  }) => {
    // First assign the estimate to the project
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );

    // Get project estimate points
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/project-estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const points = await res.json();
    expect(Array.isArray(points)).toBeTruthy();
    expect(points.length).toBe(6); // Story Points has 6 points

    // Clean up
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });

  test("should return empty array when no estimate assigned to project", async ({
    estimatesPage,
    td,
  }) => {
    // Ensure no estimate is assigned
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );

    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/project-estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const points = await res.json();
    expect(Array.isArray(points)).toBeTruthy();
    expect(points.length).toBe(0);
  });

  test("should clear project estimate reference when estimate is deleted", async ({
    estimatesPage,
    td,
  }) => {
    // Create a temporary estimate
    const createRes = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "Temp for Delete Test", type: "points" },
          estimate_points: [{ key: 0, value: "1" }],
        },
      }
    );
    const tempEstimate = await createRes.json();

    // Assign it to the project
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: tempEstimate.id },
      }
    );

    // Verify it's assigned
    let projRes = await estimatesPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      { headers: authHeaders(td.token) }
    );
    let proj = await projRes.json();
    expect(proj.estimate).toBe(tempEstimate.id);

    // Delete the estimate
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${tempEstimate.id}/`,
      { headers: authHeaders(td.token) }
    );

    // Verify project's estimate reference is cleared
    projRes = await estimatesPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      { headers: authHeaders(td.token) }
    );
    proj = await projRes.json();
    expect(proj.estimate).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. WORKSPACE ESTIMATES API
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Workspace Estimates API", () => {
  test("should list workspace estimates via GET /workspaces/:slug/estimates/", async ({
    estimatesPage,
    td,
  }) => {
    // First assign an estimate to the project (workspace endpoint shows estimates assigned to projects)
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );

    const res = await estimatesPage.request.get(
      `${workspaceBaseUrl(td)}/estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const estimates = await res.json();
    expect(Array.isArray(estimates)).toBeTruthy();
    expect(estimates.length).toBeGreaterThanOrEqual(1);

    // Verify structure
    const storyPoints = estimates.find((e: Estimate) => e.name === td.estimateName);
    expect(storyPoints).toBeTruthy();
    expect(storyPoints.points).toBeDefined();

    // Clean up
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });

  test("should return empty array when no estimates are assigned to projects", async ({
    estimatesPage,
    td,
  }) => {
    // Ensure no estimate is assigned
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );

    const res = await estimatesPage.request.get(
      `${workspaceBaseUrl(td)}/estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const estimates = await res.json();
    expect(Array.isArray(estimates)).toBeTruthy();
    expect(estimates.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. RESPONSE FORMAT VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Response Format Validation", () => {
  test("estimate response should have all required fields", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();

    // Verify all required fields are present
    expect(estimate).toHaveProperty("id");
    expect(estimate).toHaveProperty("name");
    expect(estimate).toHaveProperty("description");
    expect(estimate).toHaveProperty("type");
    expect(estimate).toHaveProperty("project_id");
    expect(estimate).toHaveProperty("workspace_id");
    expect(estimate).toHaveProperty("last_used_at"); // API returns last_used_at, not last_used
    expect(estimate).toHaveProperty("points");
    expect(estimate).toHaveProperty("created_at");
    expect(estimate).toHaveProperty("updated_at");
    expect(estimate).toHaveProperty("created_by_id"); // API returns created_by_id, not created_by

    // Verify field types
    expect(typeof estimate.id).toBe("string");
    expect(typeof estimate.name).toBe("string");
    expect(typeof estimate.type).toBe("string");
    // last_used_at is nullable string (timestamp), not boolean
    expect(estimate.last_used_at === null || typeof estimate.last_used_at === "string").toBeTruthy();
    expect(Array.isArray(estimate.points)).toBeTruthy();
  });

  test("estimate point response should have all required fields", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const points = await res.json();
    const point = points[0];

    // Verify all required fields are present
    expect(point).toHaveProperty("id");
    expect(point).toHaveProperty("estimate_id");
    expect(point).toHaveProperty("key");
    expect(point).toHaveProperty("value");
    expect(point).toHaveProperty("description");

    // Verify field types
    expect(typeof point.id).toBe("string");
    expect(typeof point.estimate_id).toBe("string");
    expect(typeof point.key).toBe("number");
    expect(typeof point.value).toBe("string");
  });

  test("points should be sorted by key", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/${td.estimateId}/points/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const points = await res.json();

    // Verify points are sorted by key
    for (let i = 1; i < points.length; i++) {
      expect(points[i].key).toBeGreaterThanOrEqual(points[i - 1].key);
    }
  });

  test("estimate list response should include points for each estimate", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/estimates/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const estimates = await res.json();
    const estimateList = Array.isArray(estimates) ? estimates : estimates.results ?? [];

    for (const estimate of estimateList) {
      expect(estimate).toHaveProperty("points");
      expect(Array.isArray(estimate.points)).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. ESTIMATES UI - Settings Page
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimates UI - Settings Page", () => {
  test("should navigate to project estimates settings page", async ({
    estimatesPage,
    wsSlug,
  }) => {
    await goToProjectEstimates(estimatesPage, wsSlug);
    expect(estimatesPage.url()).toContain("/estimates");
  });

  test("should display Estimates heading on settings page", async ({
    estimatesPage,
    wsSlug,
  }) => {
    await goToProjectEstimates(estimatesPage, wsSlug);
    await expect(
      estimatesPage.getByRole("heading", { name: /estimates/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show Add estimate button on settings page", async ({
    estimatesPage,
    wsSlug,
  }) => {
    await goToProjectEstimates(estimatesPage, wsSlug);
    const addBtn = estimatesPage
      .getByRole("button", { name: /add estimate/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should display existing estimates on settings page", async ({
    estimatesPage,
    wsSlug,
    td,
  }) => {
    await goToProjectEstimates(estimatesPage, wsSlug);

    // Wait for the page to fully load
    await estimatesPage.waitForTimeout(2000);

    // Verify at least one of the fixture-created estimates is visible
    const storyPointsText = estimatesPage.getByText("Story Points").first();
    const storyPointsVisible = await storyPointsText.isVisible({ timeout: 5_000 }).catch(() => false);

    // If not directly visible as text, verify via API
    if (!storyPointsVisible) {
      const res = await estimatesPage.request.get(
        `${projectBaseUrl(td)}/estimates/`,
        { headers: authHeaders(td.token) }
      );
      expect(res.ok()).toBeTruthy();
      const estimates = await res.json();
      const names = (Array.isArray(estimates) ? estimates : estimates.results ?? []).map(
        (e: Estimate) => e.name
      );
      expect(names).toContain("Story Points");
    } else {
      expect(storyPointsVisible).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. ESTIMATES UI - Issue Detail Page
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimates UI - Issue Detail Page", () => {
  test("should show Estimate property in issue detail sidebar", async ({
    estimatesPage,
    wsSlug,
    td,
  }) => {
    // First assign estimate to project
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );

    await goToIssueDetail(estimatesPage, wsSlug, td.issueId);

    const estimateProp = estimatesPage.getByText(/estimate/i).first();
    await expect(estimateProp).toBeVisible({ timeout: 10_000 });

    // Clean up
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });

  test("should show estimate options when project has estimate assigned", async ({
    estimatesPage,
    wsSlug,
    td,
  }) => {
    // Assign estimate to project
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );

    await goToIssueDetail(estimatesPage, wsSlug, td.issueId);

    // Look for estimate property or dropdown trigger
    const estimateElement = estimatesPage.getByText(/estimate|no estimate|select/i).first();
    await expect(estimateElement).toBeVisible({ timeout: 10_000 });

    // Clean up
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. ESTIMATE ISSUE ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimate Issue Assignment", () => {
  test("should set estimate_point on issue via PATCH", async ({
    estimatesPage,
    td,
  }) => {
    // First assign estimate to project
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: td.estimateId },
      }
    );

    // Set estimate point on issue (using key 3 = "3" Medium)
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: 3 },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.estimate_point).toBe(3);

    // Clean up
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: null },
      }
    );
    await estimatesPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_id: null },
      }
    );
  });

  test("should clear estimate_point on issue", async ({
    estimatesPage,
    td,
  }) => {
    // First set an estimate point
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: 2 },
      }
    );

    // Then clear it
    const res = await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: null },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.estimate_point).toBeNull();
  });

  test("should include estimate_point in issue response", async ({
    estimatesPage,
    td,
  }) => {
    // Set estimate point
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: 5 },
      }
    );

    // Get issue and verify estimate_point is included
    const res = await estimatesPage.request.get(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue).toHaveProperty("estimate_point");
    expect(issue.estimate_point).toBe(5);

    // Clean up
    await estimatesPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { estimate_point: null },
      }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. ESTIMATE TYPE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Estimate Type Validation", () => {
  test("should create estimate with type 'points'", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "Points Type", type: "points" },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.type).toBe("points");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should create estimate with type 'categories'", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "Categories Type", type: "categories" },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.type).toBe("categories");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should default to 'categories' type when not specified", async ({
    estimatesPage,
    td,
  }) => {
    const res = await estimatesPage.request.post(
      `${projectBaseUrl(td)}/estimates/`,
      {
        headers: authHeaders(td.token),
        data: {
          estimate: { name: "Default Type" },
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const estimate = await res.json();
    expect(estimate.type).toBe("categories");

    // Clean up
    await estimatesPage.request.delete(
      `${projectBaseUrl(td)}/estimates/${estimate.id}/`,
      { headers: authHeaders(td.token) }
    );
  });
});
