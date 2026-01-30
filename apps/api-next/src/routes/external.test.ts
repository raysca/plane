import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { Hono } from "hono";

// Test app that replicates the unsplash endpoint logic
const app = new Hono();

// Mock environment variable state
let mockAccessKey: string | undefined;

app.get("/api/unsplash/", async (c) => {
  const UNSPLASH_ACCESS_KEY = mockAccessKey;

  if (!UNSPLASH_ACCESS_KEY) {
    return c.json([], 200);
  }

  const query = c.req.query("query");
  const page = c.req.query("page") || "1";
  const perPage = c.req.query("per_page") || "20";

  const url = query
    ? `https://api.unsplash.com/search/photos/?client_id=${UNSPLASH_ACCESS_KEY}&query=${query}&page=${page}&per_page=${perPage}`
    : `https://api.unsplash.com/photos/?client_id=${UNSPLASH_ACCESS_KEY}&page=${page}&per_page=${perPage}`;

  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  const data = await resp.json();
  return c.json(data, resp.status as any);
});

// Mock fetch globally for tests
const originalFetch = globalThis.fetch;

describe("GET /api/unsplash/", () => {
  beforeAll(() => {
    // Mock fetch to avoid real API calls
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("api.unsplash.com/search/photos")) {
        return new Response(
          JSON.stringify({
            total: 100,
            total_pages: 5,
            results: [
              {
                id: "abc123",
                created_at: "2024-01-01T00:00:00Z",
                updated_at: "2024-01-01T00:00:00Z",
                width: 4000,
                height: 3000,
                color: "#000000",
                blur_hash: "LKO2:N%2T",
                description: "A test photo",
                alt_description: "test photo",
                urls: {
                  raw: "https://images.unsplash.com/photo-abc123",
                  full: "https://images.unsplash.com/photo-abc123?q=100",
                  regular: "https://images.unsplash.com/photo-abc123?w=1080",
                  small: "https://images.unsplash.com/photo-abc123?w=400",
                  thumb: "https://images.unsplash.com/photo-abc123?w=200",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("api.unsplash.com/photos")) {
        return new Response(
          JSON.stringify([
            {
              id: "def456",
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
              width: 5000,
              height: 3500,
              color: "#ffffff",
              blur_hash: "LAB123",
              description: "A browse photo",
              alt_description: "browse photo",
              urls: {
                raw: "https://images.unsplash.com/photo-def456",
                full: "https://images.unsplash.com/photo-def456?q=100",
                regular: "https://images.unsplash.com/photo-def456?w=1080",
                small: "https://images.unsplash.com/photo-def456?w=400",
                thumb: "https://images.unsplash.com/photo-def456?w=200",
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns empty array when UNSPLASH_ACCESS_KEY is not set", async () => {
    mockAccessKey = undefined;

    const res = await app.request("/api/unsplash/");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns empty array when UNSPLASH_ACCESS_KEY is empty string", async () => {
    mockAccessKey = "";

    const res = await app.request("/api/unsplash/");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns browse photos when no query param", async () => {
    mockAccessKey = "test-access-key";

    const res = await app.request("/api/unsplash/");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("def456");
    expect(data[0].urls.regular).toContain("unsplash.com");
  });

  test("returns search results when query param is provided", async () => {
    mockAccessKey = "test-access-key";

    const res = await app.request("/api/unsplash/?query=nature");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(data.results.length).toBe(1);
    expect(data.results[0].id).toBe("abc123");
    expect(data.total).toBe(100);
  });

  test("passes page parameter correctly", async () => {
    mockAccessKey = "test-access-key";

    // Capture the URL that fetch receives
    let capturedUrl = "";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return prevFetch(input);
    }) as typeof fetch;

    await app.request("/api/unsplash/?page=3");
    expect(capturedUrl).toContain("page=3");

    globalThis.fetch = prevFetch;
  });

  test("passes per_page parameter correctly", async () => {
    mockAccessKey = "test-access-key";

    let capturedUrl = "";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return prevFetch(input);
    }) as typeof fetch;

    await app.request("/api/unsplash/?per_page=10");
    expect(capturedUrl).toContain("per_page=10");

    globalThis.fetch = prevFetch;
  });

  test("defaults to page=1 and per_page=20", async () => {
    mockAccessKey = "test-access-key";

    let capturedUrl = "";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return prevFetch(input);
    }) as typeof fetch;

    await app.request("/api/unsplash/");
    expect(capturedUrl).toContain("page=1");
    expect(capturedUrl).toContain("per_page=20");

    globalThis.fetch = prevFetch;
  });

  test("uses search endpoint when query is provided", async () => {
    mockAccessKey = "test-access-key";

    let capturedUrl = "";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return prevFetch(input);
    }) as typeof fetch;

    await app.request("/api/unsplash/?query=mountains");
    expect(capturedUrl).toContain("search/photos");
    expect(capturedUrl).toContain("query=mountains");

    globalThis.fetch = prevFetch;
  });

  test("uses browse endpoint when no query is provided", async () => {
    mockAccessKey = "test-access-key";

    let capturedUrl = "";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return prevFetch(input);
    }) as typeof fetch;

    await app.request("/api/unsplash/");
    expect(capturedUrl).not.toContain("search/photos");
    expect(capturedUrl).toContain("api.unsplash.com/photos/");

    globalThis.fetch = prevFetch;
  });
});
