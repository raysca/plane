import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for web-next
 *
 * Connects to the Bun server's auth endpoints at /api/auth/*
 * Uses window.location.origin for absolute URL (required by Better Auth)
 */
const getBaseURL = () => {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/auth`;
  }
  return "http://localhost:8000/api/auth";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
});

// Re-export types
export type Session = typeof authClient.$Infer.Session;
export type User = Session["user"];
