import { test, expect } from "../../fixtures/base";

test.describe("Admin Dashboard", () => {
  test("should load the admin instance endpoint", async ({ apiContext }) => {
    const response = await apiContext.get("/api/instances/");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("should list workspaces via the API", async ({ apiContext }) => {
    const response = await apiContext.get("/api/workspaces/");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("should create a workspace", async ({ apiContext }) => {
    const slug = `e2e-ws-${Date.now().toString(36)}`;

    const response = await apiContext.post("/api/workspaces/", {
      data: {
        name: "E2E Test Workspace",
        slug,
        organization_size: "1-10",
      },
    });
    expect(response.ok()).toBeTruthy();

    const workspace = await response.json();
    expect(workspace.slug).toBe(slug);
    expect(workspace.name).toBe("E2E Test Workspace");
  });

  test("should access workspace after creation", async ({ apiContext }) => {
    const slug = `e2e-access-${Date.now().toString(36)}`;

    // Create workspace
    const createResponse = await apiContext.post("/api/workspaces/", {
      data: {
        name: "Access Test Workspace",
        slug,
        organization_size: "1-10",
      },
    });
    expect(createResponse.ok()).toBeTruthy();

    // Fetch workspace
    const getResponse = await apiContext.get(`/api/workspaces/${slug}/`);
    expect(getResponse.ok()).toBeTruthy();

    const workspace = await getResponse.json();
    expect(workspace.slug).toBe(slug);
  });

  test("should create a project within a workspace", async ({ apiContext }) => {
    const slug = `e2e-proj-${Date.now().toString(36)}`;

    // Create workspace
    const wsResponse = await apiContext.post("/api/workspaces/", {
      data: {
        name: "Project Test Workspace",
        slug,
        organization_size: "1-10",
      },
    });
    expect(wsResponse.ok()).toBeTruthy();

    // Create project
    const projResponse = await apiContext.post(`/api/workspaces/${slug}/projects/`, {
      data: {
        name: "E2E Test Project",
        identifier: "E2E",
        network: 2,
      },
    });
    expect(projResponse.ok()).toBeTruthy();

    const project = await projResponse.json();
    expect(project.name).toBe("E2E Test Project");
    expect(project.identifier).toBe("E2E");
  });
});
