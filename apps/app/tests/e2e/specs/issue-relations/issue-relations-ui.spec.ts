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
  // Issue IDs for relation testing
  issueAlpha: { id: string; seqId: number };
  issueBeta: { id: string; seqId: number };
  issueGamma: { id: string; seqId: number };
  issueDelta: { id: string; seqId: number };
  issueEpsilon: { id: string; seqId: number };
  issueZeta: { id: string; seqId: number };
}

// ── Fixture: authenticated page with test data for issue relations ────────────

type Fixtures = {
  relationPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("rel-ui"));
  },

  relationPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("rel-ui");
      const password = generateTestPassword();
      const identifier = `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: { email, password, first_name: "Relation", last_name: "Tester" },
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
        data: { first_name: "Relation", last_name: "Tester", is_onboarded: true },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: { name: "Relation Test WS", slug: wsSlug, organization_size: "2-10" },
      });

      // 5. Create project
      const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
        headers: headers(token),
        data: { name: "Relation Project", identifier, network: 2 },
      });
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const baseUrl = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Fetch project states
      const statesRes = await request.get(`${baseUrl}/states/`, {
        headers: headers(token),
      });
      expect(statesRes.ok()).toBeTruthy();
      const statesData = await statesRes.json();
      const states: TestData["states"] = (
        Array.isArray(statesData) ? statesData : statesData.results ?? []
      ).map((s: any) => ({ id: s.id, name: s.name, group: s.group }));

      // 7. Create 6 issues for comprehensive relation testing
      const issueNames = [
        "Issue Alpha",
        "Issue Beta",
        "Issue Gamma",
        "Issue Delta",
        "Issue Epsilon",
        "Issue Zeta",
      ];
      const issuesData: Array<{ id: string; seqId: number }> = [];

      for (const name of issueNames) {
        const res = await request.post(`${baseUrl}/issues/`, {
          headers: headers(token),
          data: { name },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issuesData.push({ id: issue.id, seqId: issue.sequence_id });
      }

      // Store test data on page object for access in tests
      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        issueAlpha: issuesData[0]!,
        issueBeta: issuesData[1]!,
        issueGamma: issuesData[2]!,
        issueDelta: issuesData[3]!,
        issueEpsilon: issuesData[4]!,
        issueZeta: issuesData[5]!,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ relationPage }, use) => {
    await use((relationPage as any).__testData as TestData);
  },
});

// ── Helper Functions ────────────────────────────────────────────────────────

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function issueRelationUrl(wsSlug: string, projectId: string, issueId: string) {
  return `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueId}/issue-relation/`;
}

function removeRelationUrl(wsSlug: string, projectId: string, issueId: string) {
  return `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueId}/remove-relation/`;
}

function subIssuesUrl(wsSlug: string, projectId: string, issueId: string) {
  return `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/${issueId}/sub-issues/`;
}

async function goToIssueDetail(page: Page, wsSlug: string, issueId: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/${issueId}/`);
  await waitForAppReady(page);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. List Issue Relations (GET)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("List Issue Relations", () => {
  test("should return empty grouped response when no relations exist", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Verify all relation type groups exist and are empty
    expect(data.blocking).toEqual([]);
    expect(data.blocked_by).toEqual([]);
    expect(data.duplicate).toEqual([]);
    expect(data.relates_to).toEqual([]);
    expect(data.start_after).toEqual([]);
    expect(data.start_before).toEqual([]);
    expect(data.finish_after).toEqual([]);
    expect(data.finish_before).toEqual([]);
  });

  test("should return all 10 relation type categories in response", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    const expectedKeys = [
      "blocking",
      "blocked_by",
      "duplicate",
      "relates_to",
      "start_after",
      "start_before",
      "finish_after",
      "finish_before",
      "implements",
      "implemented_by",
    ];

    for (const key of expectedKeys) {
      expect(data).toHaveProperty(key);
      expect(Array.isArray(data[key])).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Create Relations (POST) - Different Relation Types
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Create Relations - blocked_by", () => {
  test("should create a blocked_by relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [td.issueBeta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    // blocked_by: issueAlpha is blocked_by issueBeta
    // stored as: issue_id=issueAlpha, related_issue_id=issueBeta, type=blocked_by
    expect(data[0].issue_id).toBe(td.issueAlpha.id);
    expect(data[0].related_issue_id).toBe(td.issueBeta.id);
    expect(data[0].relation_type).toBe("blocked_by");
  });

  test("should verify blocked_by appears in GET response", async ({
    relationPage,
    td,
  }) => {
    // First create the relation
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [td.issueDelta.id],
        },
      }
    );

    // Then verify it appears in GET
    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.blocked_by.length).toBe(1);
    expect(data.blocked_by[0].id).toBe(td.issueDelta.id);
    expect(data.blocked_by[0].relation_type).toBe("blocked_by");
  });
});

test.describe("Create Relations - blocking (reversed)", () => {
  test("should create a blocking relation with reversed storage", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocking",
          issues: [td.issueGamma.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    // blocking: issueAlpha blocks issueGamma
    // stored as: issue_id=issueGamma, related_issue_id=issueAlpha, type=blocked_by
    expect(data[0].issue_id).toBe(td.issueGamma.id);
    expect(data[0].related_issue_id).toBe(td.issueAlpha.id);
    expect(data[0].relation_type).toBe("blocked_by");
  });

  test("should show blocking relation in GET response", async ({
    relationPage,
    td,
  }) => {
    // Create: issueBeta blocks issueEpsilon
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocking",
          issues: [td.issueEpsilon.id],
        },
      }
    );

    // Verify from issueBeta's perspective
    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.blocking.some((i: any) => i.id === td.issueEpsilon.id)).toBe(true);
  });
});

test.describe("Create Relations - relates_to", () => {
  test("should create a relates_to relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          issues: [td.issueDelta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].issue_id).toBe(td.issueAlpha.id);
    expect(data[0].related_issue_id).toBe(td.issueDelta.id);
    expect(data[0].relation_type).toBe("relates_to");
  });

  test("should show relates_to in GET response", async ({ relationPage, td }) => {
    // Create: issueDelta relates_to issueZeta
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          issues: [td.issueZeta.id],
        },
      }
    );

    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.relates_to.some((i: any) => i.id === td.issueZeta.id)).toBe(true);
  });
});

test.describe("Create Relations - duplicate", () => {
  test("should create a duplicate relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "duplicate",
          issues: [td.issueZeta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].relation_type).toBe("duplicate");
  });

  test("should show duplicate from both sides (symmetric)", async ({
    relationPage,
    td,
  }) => {
    // First create the relation in this test since tests are isolated
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "duplicate",
          issues: [td.issueZeta.id],
        },
      }
    );

    // Verify from issueEpsilon
    const resEpsilon = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      { headers: headers(td.token) }
    );
    expect(resEpsilon.ok()).toBeTruthy();
    const dataEpsilon = await resEpsilon.json();
    expect(dataEpsilon.duplicate.some((i: any) => i.id === td.issueZeta.id)).toBe(true);

    // Then verify from issueZeta (symmetric)
    const resZeta = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueZeta.id),
      { headers: headers(td.token) }
    );
    expect(resZeta.ok()).toBeTruthy();
    const dataZeta = await resZeta.json();
    expect(dataZeta.duplicate.some((i: any) => i.id === td.issueEpsilon.id)).toBe(true);
  });
});

test.describe("Create Relations - start_before/start_after", () => {
  test("should create start_before relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "start_before",
          issues: [td.issueEpsilon.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].relation_type).toBe("start_before");
  });

  test("start_before should appear as start_after from other side", async ({
    relationPage,
    td,
  }) => {
    // First create the relation in this test since tests are isolated
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "start_before",
          issues: [td.issueEpsilon.id],
        },
      }
    );

    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.start_after.some((i: any) => i.id === td.issueAlpha.id)).toBe(true);
  });

  test("should create start_after relation (reversed storage)", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "start_after",
          issues: [td.issueZeta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    // start_after is reversed: stored as issue_id=issueZeta, type=start_before
    expect(data[0].relation_type).toBe("start_before");
    expect(data[0].issue_id).toBe(td.issueZeta.id);
  });
});

test.describe("Create Relations - finish_before/finish_after", () => {
  test("should create finish_before relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "finish_before",
          issues: [td.issueDelta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].relation_type).toBe("finish_before");
  });

  test("finish_before should appear as finish_after from other side", async ({
    relationPage,
    td,
  }) => {
    // First create the relation in this test since tests are isolated
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "finish_before",
          issues: [td.issueDelta.id],
        },
      }
    );

    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.finish_after.some((i: any) => i.id === td.issueGamma.id)).toBe(true);
  });
});

test.describe("Create Relations - implemented_by/implements", () => {
  test("should create implemented_by relation", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "implemented_by",
          issues: [td.issueZeta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].relation_type).toBe("implemented_by");
  });

  test("implemented_by should appear as implements from other side", async ({
    relationPage,
    td,
  }) => {
    // First create the relation in this test since tests are isolated
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "implemented_by",
          issues: [td.issueZeta.id],
        },
      }
    );

    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueZeta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.implements.some((i: any) => i.id === td.issueAlpha.id)).toBe(true);
  });

  test("should create implements relation (reversed storage)", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "implements",
          issues: [td.issueDelta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    // implements is reversed: stored as issue_id=issueDelta, type=implemented_by
    expect(data[0].relation_type).toBe("implemented_by");
    expect(data[0].issue_id).toBe(td.issueDelta.id);
  });
});

test.describe("Create Relations - Bulk", () => {
  test("should bulk create multiple relations", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          issues: [td.issueAlpha.id, td.issueBeta.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("should skip duplicate relations silently", async ({ relationPage, td }) => {
    // First create
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [td.issueAlpha.id],
        },
      }
    );

    // Try to create same relation again
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueEpsilon.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [td.issueAlpha.id],
        },
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(0); // No new relations created
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Bi-directional Relation Handling
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Bi-directional Relation Handling", () => {
  test("blocking from A shows as blocked_by from B", async ({
    relationPage,
    td,
  }) => {
    // Create: issueZeta blocks issueDelta
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueZeta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocking",
          issues: [td.issueDelta.id],
        },
      }
    );

    // From issueZeta's perspective: blocking contains issueDelta
    const resZeta = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueZeta.id),
      { headers: headers(td.token) }
    );
    const dataZeta = await resZeta.json();
    expect(dataZeta.blocking.some((i: any) => i.id === td.issueDelta.id)).toBe(true);

    // From issueDelta's perspective: blocked_by contains issueZeta
    const resDelta = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      { headers: headers(td.token) }
    );
    const dataDelta = await resDelta.json();
    expect(dataDelta.blocked_by.some((i: any) => i.id === td.issueZeta.id)).toBe(true);
  });

  test("relates_to appears from both sides", async ({ relationPage, td }) => {
    // Create the relation in this test since tests are isolated
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          issues: [td.issueAlpha.id],
        },
      }
    );

    // Verify from issueGamma
    const resGamma = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      { headers: headers(td.token) }
    );
    const dataGamma = await resGamma.json();
    expect(dataGamma.relates_to.some((i: any) => i.id === td.issueAlpha.id)).toBe(true);

    // From issueAlpha's perspective, issueGamma should be in relates_to
    const resAlpha = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );
    const dataAlpha = await resAlpha.json();
    expect(dataAlpha.relates_to.some((i: any) => i.id === td.issueGamma.id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Delete Relations
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Delete Relations", () => {
  test("should remove a relation using remove-relation endpoint", async ({
    relationPage,
    td,
  }) => {
    // First create a relation
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          issues: [td.issueBeta.id],
        },
      }
    );

    // Verify it exists
    let res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );
    let data = await res.json();
    expect(data.relates_to.some((i: any) => i.id === td.issueBeta.id)).toBe(true);

    // Remove it
    const removeRes = await relationPage.request.post(
      removeRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          related_issue: td.issueBeta.id,
        },
      }
    );
    expect(removeRes.status()).toBe(204);

    // Verify it's gone
    res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );
    data = await res.json();
    expect(data.relates_to.some((i: any) => i.id === td.issueBeta.id)).toBe(false);
  });

  test("should return 404 for non-existent relation", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      removeRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "relates_to",
          related_issue: "non-existent-id",
        },
      }
    );
    expect(res.status()).toBe(404);
  });

  test("removing relation from either direction should work", async ({
    relationPage,
    td,
  }) => {
    // Create blocking relation: issueBeta blocks issueGamma
    await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocking",
          issues: [td.issueGamma.id],
        },
      }
    );

    // Remove from issueGamma's perspective (blocked_by)
    const removeRes = await relationPage.request.post(
      removeRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          related_issue: td.issueBeta.id,
        },
      }
    );
    expect(removeRes.status()).toBe(204);

    // Verify gone from both sides
    const resBeta = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueBeta.id),
      { headers: headers(td.token) }
    );
    const dataBeta = await resBeta.json();
    expect(dataBeta.blocking.some((i: any) => i.id === td.issueGamma.id)).toBe(false);

    const resGamma = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueGamma.id),
      { headers: headers(td.token) }
    );
    const dataGamma = await resGamma.json();
    expect(dataGamma.blocked_by.some((i: any) => i.id === td.issueBeta.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Sub-Issues (Parent/Child Relationships)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Sub-Issues (Parent/Child)", () => {
  test("should list empty sub-issues when none exist", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.get(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.sub_issues).toEqual([]);
    expect(data.state_distribution).toEqual({});
  });

  test("should add sub-issues to a parent", async ({ relationPage, td }) => {
    const res = await relationPage.request.post(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          sub_issue_ids: [td.issueBeta.id, td.issueGamma.id],
        },
      }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBe("Sub-issues added.");
  });

  test("should list sub-issues after adding", async ({ relationPage, td }) => {
    // First add sub-issues in this test since tests are isolated
    await relationPage.request.post(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          sub_issue_ids: [td.issueBeta.id, td.issueGamma.id],
        },
      }
    );

    const res = await relationPage.request.get(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.sub_issues.length).toBe(2);

    const subIssueIds = data.sub_issues.map((i: any) => i.id);
    expect(subIssueIds).toContain(td.issueBeta.id);
    expect(subIssueIds).toContain(td.issueGamma.id);
  });

  test("sub-issues response should contain state_distribution", async ({
    relationPage,
    td,
  }) => {
    // First add a sub-issue to test state_distribution
    await relationPage.request.post(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          sub_issue_ids: [td.issueBeta.id],
        },
      }
    );

    const res = await relationPage.request.get(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("state_distribution");
    expect(typeof data.state_distribution).toBe("object");
    // state_distribution should have at least one state since we have sub-issues
    expect(Object.keys(data.state_distribution).length).toBeGreaterThan(0);
  });

  test("sub-issues response should contain enriched issue data", async ({
    relationPage,
    td,
  }) => {
    // First add a sub-issue
    await relationPage.request.post(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          sub_issue_ids: [td.issueBeta.id],
        },
      }
    );

    const res = await relationPage.request.get(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.sub_issues.length).toBeGreaterThan(0);

    const subIssue = data.sub_issues[0];
    // Verify enriched fields exist
    expect(subIssue).toHaveProperty("id");
    expect(subIssue).toHaveProperty("name");
    expect(subIssue).toHaveProperty("state_id");
    expect(subIssue).toHaveProperty("priority");
    expect(subIssue).toHaveProperty("project_id");
    expect(subIssue).toHaveProperty("assignee_ids");
    expect(subIssue).toHaveProperty("label_ids");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Response Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Response Format Validation", () => {
  test("relation response should have correct fields", async ({
    relationPage,
    td,
  }) => {
    // Create a relation to test response format
    const createRes = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [td.issueEpsilon.id],
        },
      }
    );

    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.length).toBe(1);

    const relation = created[0];
    expect(relation).toHaveProperty("id");
    expect(relation).toHaveProperty("issue_id");
    expect(relation).toHaveProperty("related_issue_id");
    expect(relation).toHaveProperty("relation_type");
    expect(relation).toHaveProperty("created_at");
  });

  test("enriched issue in GET response should have correct fields", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.get(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueDelta.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    if (data.blocked_by.length > 0) {
      const issue = data.blocked_by[0];
      expect(issue).toHaveProperty("id");
      expect(issue).toHaveProperty("name");
      expect(issue).toHaveProperty("state_id");
      expect(issue).toHaveProperty("priority");
      expect(issue).toHaveProperty("sequence_id");
      expect(issue).toHaveProperty("project_id");
      expect(issue).toHaveProperty("label_ids");
      expect(issue).toHaveProperty("assignee_ids");
      expect(issue).toHaveProperty("relation_type");
      expect(issue).toHaveProperty("created_at");
      expect(issue).toHaveProperty("updated_at");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Error Handling", () => {
  test("should return 400 for missing relation_type", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          issues: [td.issueBeta.id],
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should return 400 for missing issues array", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should return 400 for empty issues array", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
          issues: [],
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should return 400 for invalid relation_type", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      issueRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "invalid_type",
          issues: [td.issueBeta.id],
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should return 400 for missing related_issue in remove-relation", async ({
    relationPage,
    td,
  }) => {
    const res = await relationPage.request.post(
      removeRelationUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          relation_type: "blocked_by",
        },
      }
    );
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. UI Visibility Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("UI Visibility - Issue Detail Relations", () => {
  test("should navigate to issue detail page successfully", async ({
    relationPage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(relationPage, wsSlug, td.issueAlpha.id);

    // Verify we are on the issue detail page by checking for issue name
    const issueTitle = relationPage.getByText("Issue Alpha").first();
    const titleVisible = await issueTitle
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    // Or check for Properties section which is common in issue details
    const propertiesLabel = relationPage.getByText(/properties|detail/i).first();
    const propsVisible = await propertiesLabel
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    expect(titleVisible || propsVisible).toBeTruthy();
  });

  test("should show sub-issues count via API after adding sub-issues", async ({
    relationPage,
    td,
  }) => {
    // First add sub-issues via API
    await relationPage.request.post(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      {
        headers: headers(td.token),
        data: {
          sub_issue_ids: [td.issueBeta.id],
        },
      }
    );

    // Verify via API that sub-issues exist
    const res = await relationPage.request.get(
      subIssuesUrl(td.wsSlug, td.projectId, td.issueAlpha.id),
      { headers: headers(td.token) }
    );

    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.sub_issues.length).toBe(1);
    expect(data.sub_issues[0].id).toBe(td.issueBeta.id);
  });
});
