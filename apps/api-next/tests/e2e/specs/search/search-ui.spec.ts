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
  identifier: string;
  states: Array<{ id: string; name: string; group: string }>;
  cycleId: string;
  moduleId: string;
  viewId: string;
  issueIds: string[];
  issueNames: string[];
  issueSeqs: number[];
  pageId: string;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  searchPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("srch"));
  },

  searchPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("srch");
      const password = generateTestPassword();
      const identifier = `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Search",
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
          first_name: "Search",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Search Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: {
            name: "Search Project",
            identifier,
            network: 2,
          },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Fetch states
      const statesRes = await request.get(`${base_url}/states/`, {
        headers: headers(token),
      });
      expect(statesRes.ok()).toBeTruthy();
      const statesData = await statesRes.json();
      const states: TestData["states"] = (
        Array.isArray(statesData) ? statesData : statesData.results ?? []
      ).map((s: any) => ({ id: s.id, name: s.name, group: s.group }));

      // 7. Create cycle
      const cycleRes = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: "Search Sprint" },
      });
      expect(cycleRes.ok()).toBeTruthy();
      const cycle = await cycleRes.json();

      // 8. Create module
      const modRes = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: "Search Module" },
      });
      expect(modRes.ok()).toBeTruthy();
      const mod = await modRes.json();

      // 9. Create view
      const viewRes = await request.post(`${base_url}/views/`, {
        headers: headers(token),
        data: { name: "Search View" },
      });
      expect(viewRes.ok()).toBeTruthy();
      const view = await viewRes.json();

      // 10. Create 3 issues with unique names
      const issueNames = [
        "Searchable Alpha Task",
        "Searchable Beta Task",
        "Unique Gamma Widget",
      ];
      const issueIds: string[] = [];
      const issueSeqs: number[] = [];
      for (const name of issueNames) {
        const res = await request.post(`${base_url}/issues/`, {
          headers: headers(token),
          data: { name },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issueIds.push(issue.id);
        issueSeqs.push(issue.sequence_id);
      }

      // 11. Create a page
      const pageRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/pages/`,
        {
          headers: headers(token),
          data: { name: "Search Test Page", access: 0 },
        }
      );
      expect(pageRes.ok()).toBeTruthy();
      const pg = await pageRes.json();

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        cycleId: cycle.id,
        moduleId: mod.id,
        viewId: view.id,
        issueIds,
        issueNames,
        issueSeqs,
        pageId: pg.id,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ searchPage }, use) => {
    await use((searchPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function searchUrl(wsSlug: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}/search/`;
}

function entitySearchUrl(wsSlug: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}/entity-search/`;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH API
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Global Search API", () => {
  test("should return results for all entity types", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search",
        workspace_search: "true",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results).toBeDefined();

    // Should have result keys for entity types
    const keys = Object.keys(data.results);
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });

  test("should find issues by name", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Searchable",
        workspace_search: "true",
        entities: "issue",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.results?.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(2);

    const names = issues.map((i: any) => i.name);
    expect(names).toContain("Searchable Alpha Task");
    expect(names).toContain("Searchable Beta Task");
  });

  test("should find issue by sequence ID", async ({ searchPage, td }) => {
    const seqId = td.issueSeqs[0]!;
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: String(seqId),
        workspace_search: "true",
        entities: "issue",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.results?.issue ?? [];
    const found = issues.find((i: any) => i.sequence_id === seqId);
    expect(found).toBeTruthy();
    expect(found.name).toBe(td.issueNames[0]);
  });

  test("should find project by name", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search Project",
        workspace_search: "true",
        entities: "project",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const projects = data.results?.project ?? [];
    expect(projects.length).toBeGreaterThanOrEqual(1);

    const found = projects.find((p: any) => p.id === td.projectId);
    expect(found).toBeTruthy();
    expect(found.identifier).toBe(td.identifier);
  });

  test("should find cycle by name", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search Sprint",
        workspace_search: "true",
        entities: "cycle",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const cycles = data.results?.cycle ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0].name).toBe("Search Sprint");
  });

  test("should find module by name", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search Module",
        workspace_search: "true",
        entities: "module",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const modules = data.results?.module ?? [];
    expect(modules.length).toBeGreaterThanOrEqual(1);
    expect(modules[0].name).toBe("Search Module");
  });

  test("should find view by name", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search View",
        workspace_search: "true",
        entities: "issue_view",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const views = data.results?.issue_view ?? [];
    expect(views.length).toBeGreaterThanOrEqual(1);
    expect(views[0].name).toBe("Search View");
  });

  test("should return empty results for non-matching query", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "zzz_nonexistent_query_zzz",
        workspace_search: "true",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // All entity arrays should be empty
    for (const key of Object.keys(data.results)) {
      expect(data.results[key].length).toBe(0);
    }
  });

  test("should filter by specific entity type", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search",
        workspace_search: "true",
        entities: "cycle",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Only cycle results should be present (or at least non-empty)
    const cycles = data.results?.cycle ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  test("should search with multiple entity types", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search",
        workspace_search: "true",
        entities: "issue,cycle,module",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Should have results for at least one of the requested types
    const issues = data.results?.issue ?? [];
    const cycles = data.results?.cycle ?? [];
    const modules = data.results?.module ?? [];
    expect(issues.length + cycles.length + modules.length).toBeGreaterThan(0);
  });

  test("should scope search to project", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Searchable",
        workspace_search: "false",
        project_id: td.projectId,
        entities: "issue",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.results?.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(2);
    // All issues should be from the test project
    for (const issue of issues) {
      expect(issue.project_id).toBe(td.projectId);
    }
  });

  test("should find issue by project identifier prefix", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: td.identifier,
        workspace_search: "true",
        entities: "issue",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.results?.issue ?? [];
    // Should find issues matching the project identifier
    expect(issues.length).toBeGreaterThanOrEqual(1);
    for (const issue of issues) {
      expect(issue.project__identifier).toBe(td.identifier);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENTITY SEARCH API
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Entity Search API", () => {
  test("should search for users (mentions)", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Search",
          query_type: "user_mention",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const mentions = data.user_mention ?? [];
    // The test user "Search Tester" should be found
    expect(mentions.length).toBeGreaterThanOrEqual(1);
  });

  test("should search for issues via entity search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Searchable",
          query_type: "issue",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  test("should search for projects via entity search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Search Project",
          query_type: "project",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const projects = data.project ?? [];
    expect(projects.length).toBeGreaterThanOrEqual(1);
    expect(projects[0].name).toBe("Search Project");
  });

  test("should search for cycles via entity search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Search Sprint",
          query_type: "cycle",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const cycles = data.cycle ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  test("should search for modules via entity search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Search Module",
          query_type: "module",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const modules = data.module ?? [];
    expect(modules.length).toBeGreaterThanOrEqual(1);
  });

  test("should search multiple entity types at once", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Search",
          query_type: "issue,project,cycle,module",
          count: "10",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // At least some of the entity types should have results
    const total =
      (data.issue?.length ?? 0) +
      (data.project?.length ?? 0) +
      (data.cycle?.length ?? 0) +
      (data.module?.length ?? 0);
    expect(total).toBeGreaterThan(0);
  });

  test("should respect count limit", async ({ searchPage, td }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Searchable",
          query_type: "issue",
          count: "1",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.issue ?? [];
    expect(issues.length).toBeLessThanOrEqual(1);
  });

  test("should scope entity search to project", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Searchable",
          query_type: "issue",
          count: "10",
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(2);
    for (const issue of issues) {
      expect(issue.project_id).toBe(td.projectId);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH UI (Command Palette)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Search UI", () => {
  test("should open command palette with keyboard shortcut", async ({
    searchPage,
    wsSlug,
    td,
  }) => {
    const projectId = (searchPage as any).__projectId;
    await searchPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(searchPage);

    // Open command palette with Cmd+K / Ctrl+K
    await searchPage.keyboard.press("Meta+k");
    await searchPage.waitForTimeout(500);

    // Look for search input in the command palette
    const searchInput = searchPage
      .getByPlaceholder(/type a command or search/i)
      .first();
    // If Meta+K didn't work, try Ctrl+K
    if (!(await searchInput.isVisible().catch(() => false))) {
      await searchPage.keyboard.press("Control+k");
      await searchPage.waitForTimeout(500);
    }

    await expect(searchInput).toBeVisible({ timeout: 5_000 });
  });

  test("should show search input in command palette", async ({
    searchPage,
    wsSlug,
    td,
  }) => {
    const projectId = (searchPage as any).__projectId;
    await searchPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(searchPage);

    // Open command palette
    await searchPage.keyboard.press("Meta+k");
    await searchPage.waitForTimeout(500);

    const searchInput = searchPage
      .getByPlaceholder(/type a command or search/i)
      .first();
    if (!(await searchInput.isVisible().catch(() => false))) {
      await searchPage.keyboard.press("Control+k");
      await searchPage.waitForTimeout(500);
    }

    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query
    await searchInput.fill("Searchable");
    await searchPage.waitForTimeout(1_000);

    // Command palette should show some content (results or loading)
    // The dialog/modal should still be open
    await expect(searchInput).toBeVisible();
  });

  test("should close command palette with Escape", async ({
    searchPage,
    wsSlug,
    td,
  }) => {
    const projectId = (searchPage as any).__projectId;
    await searchPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(searchPage);

    // Open command palette
    await searchPage.keyboard.press("Meta+k");
    await searchPage.waitForTimeout(500);

    const searchInput = searchPage
      .getByPlaceholder(/type a command or search/i)
      .first();
    if (!(await searchInput.isVisible().catch(() => false))) {
      await searchPage.keyboard.press("Control+k");
      await searchPage.waitForTimeout(500);
    }

    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Close with Escape
    await searchPage.keyboard.press("Escape");
    await searchPage.waitForTimeout(500);

    // Search input should no longer be visible
    await expect(searchInput).not.toBeVisible({ timeout: 3_000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH RESPONSE SHAPE VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Search Response Validation", () => {
  test("should return correct issue fields in global search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Searchable Alpha",
        workspace_search: "true",
        entities: "issue",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.results?.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(1);

    const issue = issues[0];
    expect(issue.id).toBeTruthy();
    expect(issue.name).toBeTruthy();
    expect(issue.sequence_id).toBeDefined();
    expect(issue.project_id).toBe(td.projectId);
    expect(issue.project__identifier).toBe(td.identifier);
    expect(issue.workspace__slug).toBe(td.wsSlug);
  });

  test("should return correct project fields in global search", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search Project",
        workspace_search: "true",
        entities: "project",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const projects = data.results?.project ?? [];
    expect(projects.length).toBeGreaterThanOrEqual(1);

    const project = projects.find((p: any) => p.id === td.projectId);
    expect(project).toBeTruthy();
    expect(project.name).toBe("Search Project");
    expect(project.identifier).toBe(td.identifier);
    expect(project.workspace__slug).toBe(td.wsSlug);
  });

  test("should return correct cycle fields with status", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(searchUrl(td.wsSlug), {
      headers: authHeaders(td.token),
      params: {
        search: "Search Sprint",
        workspace_search: "true",
        entities: "cycle",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const cycles = data.results?.cycle ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(1);

    const cycle = cycles[0];
    expect(cycle.id).toBe(td.cycleId);
    expect(cycle.name).toBe("Search Sprint");
    expect(cycle.project_id).toBe(td.projectId);
    expect(cycle.project__identifier).toBe(td.identifier);
    expect(cycle.status).toBeTruthy(); // DRAFT, CURRENT, etc.
  });

  test("should return correct entity search issue fields", async ({
    searchPage,
    td,
  }) => {
    const res = await searchPage.request.get(
      entitySearchUrl(td.wsSlug),
      {
        headers: authHeaders(td.token),
        params: {
          query: "Unique Gamma",
          query_type: "issue",
          count: "5",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const issues = data.issue ?? [];
    expect(issues.length).toBeGreaterThanOrEqual(1);

    const issue = issues[0];
    expect(issue.id).toBeTruthy();
    expect(issue.name).toBe("Unique Gamma Widget");
    expect(issue.sequence_id).toBeDefined();
    expect(issue.project_id).toBe(td.projectId);
    expect(issue.project__identifier).toBe(td.identifier);
  });
});
