import type { ServerWebSocket } from "bun";
import { app } from "./app";
import type { Server } from "http";

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
    ws.data = {
      userId: null,
      subscriptions: new Set(),
      connectedAt: Date.now(),
    };

    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
        timestamp: Date.now(),
      })
    );

    console.log(`WebSocket client connected: ${clientId}`);
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
        console.log(`WebSocket client disconnected: ${clientId}`);
        break;
      }
    }
  },

  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    console.error("WebSocket error:", error);
  },
};

function handleAuthenticate(
  ws: ServerWebSocket<WebSocketData>,
  data: { userId?: string; token?: string }
) {
  // TODO: Validate token against Better Auth session
  if (data.userId) {
    ws.data.userId = data.userId;
    ws.send(
      JSON.stringify({
        type: "authenticated",
        userId: data.userId,
      })
    );
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Authentication failed",
      })
    );
  }
}

function handleSubscribe(ws: ServerWebSocket<WebSocketData>, topic: string) {
  if (!topic) {
    ws.send(JSON.stringify({ type: "error", message: "Topic is required" }));
    return;
  }

  // TODO: Validate topic access (check workspace/project membership)
  ws.subscribe(topic);
  ws.data.subscriptions.add(topic);

  if (!topicSubscribers.has(topic)) {
    topicSubscribers.set(topic, new Set());
  }
  if (ws.data.userId) {
    topicSubscribers.get(topic)!.add(ws.data.userId);
  }

  ws.send(JSON.stringify({ type: "subscribed", topic }));
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

// Start server
const port = parseInt(process.env.PORT || "8000");

const server = Bun.serve({
  port,
  fetch(req: Request, server: Server) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    console.log(url.pathname);
    if (url.pathname === "/ws" || url.pathname === "/realtime") {
      const upgraded = server.upgrade(req, {
        data: {
          userId: null,
          subscriptions: new Set(),
          connectedAt: Date.now(),
        },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Handle HTTP requests with Hono
    return app.fetch(req);
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
