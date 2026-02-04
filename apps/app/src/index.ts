import type { ServerWebSocket, Server } from "bun";
import { app } from "./app";
import { auth } from "./lib/auth";
import { db } from "./db";
import { workspaceMembers } from "./db/schema/workspace";
import { projectMembers } from "./db/schema/project";
import { eq, and } from "drizzle-orm";
import admin from './admin/index.html'
import { instanceAdmins } from "./db/schema/instance";

// Helper to serve static files from web-next build
const WEB_DIST_PATH = "./dist/web";
async function serveWebFile(pathname: string): Promise<Response | null> {
  const filePath = `${WEB_DIST_PATH}${pathname}`;
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  return null;
}

async function serveWebIndex(): Promise<Response> {
  const file = Bun.file(`${WEB_DIST_PATH}/index.html`);
  return new Response(file, {
    headers: { "Content-Type": "text/html" },
  });
}

// WebSocket data interface
interface WebSocketData {
  userId: string | null;
  subscriptions: Set<string>;
  connectedAt: number;
}

// Store for active connections
const clients = new Map<string, ServerWebSocket<WebSocketData>>();
const topicSubscribers = new Map<string, Set<string>>();

// WebSocket handlers
const websocketHandler = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const clientId = crypto.randomUUID();
    clients.set(clientId, ws);

    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
        timestamp: Date.now(),
      })
    );
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case "authenticate":
          handleAuthenticate(ws, data);
          break;

        case "subscribe":
          handleSubscribe(ws, data.topic);
          break;

        case "unsubscribe":
          handleUnsubscribe(ws, data.topic);
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Unknown message type: ${data.type}`,
            })
          );
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
        })
      );
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    // Clean up subscriptions
    for (const topic of ws.data.subscriptions) {
      ws.unsubscribe(topic);
      const subscribers = topicSubscribers.get(topic);
      if (subscribers && ws.data.userId) {
        subscribers.delete(ws.data.userId);
        if (subscribers.size === 0) {
          topicSubscribers.delete(topic);
        }
      }
    }

    // Remove from clients
    for (const [clientId, client] of clients) {
      if (client === ws) {
        clients.delete(clientId);
        break;
      }
    }
  },

  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    console.error("WebSocket error:", error);
  },
};

async function handleAuthenticate(
  ws: ServerWebSocket<WebSocketData>,
  data: { userId?: string; token?: string }
) {
  // Validate the token against Better Auth session
  if (!data.token) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Authentication failed: token is required",
      })
    );
    return;
  }

  try {
    // Create a fake Request with the session cookie to validate via Better Auth
    const headers = new Headers();
    headers.set("cookie", `plane.session_token=${data.token}`);
    const session = await auth.api.getSession({ headers });

    if (!session || !session.user) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Authentication failed: invalid or expired session",
        })
      );
      return;
    }

    if (!session.user.isActive) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Authentication failed: account is disabled",
        })
      );
      return;
    }

    ws.data.userId = session.user.id;
    ws.send(
      JSON.stringify({
        type: "authenticated",
        userId: session.user.id,
      })
    );
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Authentication failed",
      })
    );
  }
}

async function handleSubscribe(ws: ServerWebSocket<WebSocketData>, topic: string) {
  if (!topic) {
    ws.send(JSON.stringify({ type: "error", message: "Topic is required" }));
    return;
  }

  // Require authentication before subscribing
  if (!ws.data.userId) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Authentication required before subscribing",
      })
    );
    return;
  }

  // Validate topic access by checking membership
  const authorized = await validateTopicAccess(ws.data.userId, topic);
  if (!authorized) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "You do not have access to this topic",
      })
    );
    return;
  }

  ws.subscribe(topic);
  ws.data.subscriptions.add(topic);

  if (!topicSubscribers.has(topic)) {
    topicSubscribers.set(topic, new Set());
  }
  topicSubscribers.get(topic)!.add(ws.data.userId);

  ws.send(JSON.stringify({ type: "subscribed", topic }));
}

/**
 * Validate that a user has access to a topic by checking workspace/project membership.
 * Topic format examples:
 *   workspace:<workspaceId>
 *   workspace:<workspaceId>:project:<projectId>
 *   workspace:<workspaceId>:project:<projectId>:issue:<issueId>
 *   user:<userId>
 */
async function validateTopicAccess(userId: string, topic: string): Promise<boolean> {
  const parts = topic.split(":");

  // user:<userId> - only the user themselves can subscribe
  if (parts[0] === "user" && parts.length === 2) {
    return parts[1] === userId;
  }

  // workspace:<workspaceId> topics - check workspace membership
  if (parts[0] === "workspace" && parts.length >= 2) {
    const workspaceId = parts[1];

    const membership = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.isActive, true)
      ),
    });

    if (!membership) {
      return false;
    }

    // workspace:<workspaceId>:project:<projectId> - check project membership
    if (parts.length >= 4 && parts[2] === "project") {
      const projectId = parts[3];

      const projMembership = await db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberId, userId),
          eq(projectMembers.isActive, true)
        ),
      });

      if (!projMembership) {
        return false;
      }
    }

    return true;
  }

  // Unknown topic format - deny by default
  return false;
}

function handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, topic: string) {
  ws.unsubscribe(topic);
  ws.data.subscriptions.delete(topic);

  const subscribers = topicSubscribers.get(topic);
  if (subscribers && ws.data.userId) {
    subscribers.delete(ws.data.userId);
    if (subscribers.size === 0) {
      topicSubscribers.delete(topic);
    }
  }

  ws.send(JSON.stringify({ type: "unsubscribed", topic }));
}

// Helper to extract session token from cookie header
function extractSessionToken(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;

  const match = cookie.match(/plane\.session_token=([^;]+)/);
  return match ? match[1] : null;
}

// Start server
const port = parseInt(process.env.PORT || "8000");

const server = Bun.serve({
  port,
  routes: {
    '/admin': admin,
    '/admin/*': async (req: Request) => {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // For paths beyond /admin/ (dashboard routes), check instance admin auth
      // /admin and /admin/ serve without auth (sign-in page)
      if (pathname !== '/admin' && pathname !== '/admin/') {
        try {
          const session = await auth.api.getSession({ headers: req.headers });
          if (!session || !session.user) {
            return Response.redirect(new URL('/admin', req.url).toString(), 302);
          }
          // Check if user is an instance admin
          const adminRecord = await db.query.instanceAdmins.findFirst({
            where: eq(instanceAdmins.userId, session.user.id),
          });
          if (!adminRecord) {
            return Response.redirect(new URL('/admin', req.url).toString(), 302);
          }
        } catch {
          return Response.redirect(new URL('/admin', req.url).toString(), 302);
        }
      }

      // SPA fallback: internally fetch the bundled /admin HTML from this server
      return fetch(new URL('/admin', req.url));
    },
    '/ws/*': async (req: Request, server: Server<WebSocketData>) => {
      // Validate session cookie before allowing upgrade
      const token = extractSessionToken(req);
      if (!token) {
        return new Response("Authentication required", { status: 401 });
      }

      try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session || !session.user || !session.user.isActive) {
          return new Response("Authentication required", { status: 401 });
        }

        const upgraded = server.upgrade(req, {
          data: {
            userId: session.user.id,
            subscriptions: new Set(),
            connectedAt: Date.now(),
          },
        });
        if (upgraded) {
          return undefined;
        }
      } catch {
        return new Response("Authentication failed", { status: 401 });
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    },
    '/realtime/*': async (req: Request, server: Server<WebSocketData>) => {
      // Validate session cookie before allowing upgrade
      const token = extractSessionToken(req);
      if (!token) {
        return new Response("Authentication required", { status: 401 });
      }

      try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session || !session.user || !session.user.isActive) {
          return new Response("Authentication required", { status: 401 });
        }

        const upgraded = server.upgrade(req, {
          data: {
            userId: session.user.id,
            subscriptions: new Set(),
            connectedAt: Date.now(),
          },
        });
        if (upgraded) {
          return undefined;
        }
      } catch {
        return new Response("Authentication failed", { status: 401 });
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    },
    // Serve web-next frontend for non-API routes
    '/': () => serveWebIndex(),
    '/accounts/*': () => serveWebIndex(),
    '/onboarding': () => serveWebIndex(),
    '/sign-up': () => serveWebIndex(),
    '/create-workspace': () => serveWebIndex(),
    // API routes handled by Hono app
    '/*': (req: Request, server: Server<WebSocketData>) => {
      const url = new URL(req.url);
      // Let Hono handle /api/* routes
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        return app.fetch(req, server);
      }
      // Serve static assets from dist/web
      if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
        const filePath = `./dist/web${url.pathname}`;
        const file = Bun.file(filePath);
        return file.exists().then(exists => {
          if (exists) {
            return new Response(file);
          }
          return app.fetch(req, server);
        });
      }
      // SPA fallback for all other routes
      return fetch(new URL('/', req.url));
    },
  },
  websocket: websocketHandler,
});

// Export server for realtime service
export { server };

// Publish helper for services
export function publish(topic: string, event: string, data: unknown) {
  const message = JSON.stringify({
    type: "event",
    topic,
    event,
    data,
    timestamp: Date.now(),
  });
  server.publish(topic, message);
}

// Topic helpers
export const topics = {
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
  project: (workspaceId: string, projectId: string) =>
    `workspace:${workspaceId}:project:${projectId}`,
  issue: (workspaceId: string, projectId: string, issueId: string) =>
    `workspace:${workspaceId}:project:${projectId}:issue:${issueId}`,
  user: (userId: string) => `user:${userId}`,
};

console.log(`
  ____  _                       _    ____ ___
 |  _ \\| | __ _ _ __   ___     / \\  |  _ \\_ _|
 | |_) | |/ _\` | '_ \\ / _ \\   / _ \\ | |_) | |
 |  __/| | (_| | | | |  __/  / ___ \\|  __/| |
 |_|   |_|\\__,_|_| |_|\\___| /_/   \\_\\_|  |___|

  Server running at http://localhost:${port}
  WebSocket at ws://localhost:${port}/ws
  Environment: ${process.env.NODE_ENV || "development"}
`);
// Trigger reload
