import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";

// Custom error classes
export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication credentials were not provided.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  public errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>) {
    super("Validation error");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class ConflictError extends Error {
  constructor(message = "A conflict occurred.") {
    super(message);
    this.name = "ConflictError";
  }
}

// Error handler middleware
export function errorHandler(err: Error, c: Context) {
  console.error(`[Error] ${err.name}: ${err.message}`);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }

  // Handle HTTP exceptions from Hono
  if (err instanceof HTTPException) {
    return c.json(
      {
        detail: err.message,
      },
      err.status
    );
  }

  // Handle custom errors
  if (err instanceof NotFoundError) {
    return c.json({ detail: err.message }, 404);
  }

  if (err instanceof UnauthorizedError) {
    return c.json({ detail: err.message }, 401);
  }

  if (err instanceof ForbiddenError) {
    return c.json({ detail: err.message }, 403);
  }

  if (err instanceof ValidationError) {
    return c.json(err.errors, 400);
  }

  if (err instanceof ConflictError) {
    return c.json({ detail: err.message }, 409);
  }

  // Handle Zod validation errors
  if (err.name === "ZodError") {
    const zodError = err as unknown as {
      errors: Array<{ path: (string | number)[]; message: string }>;
    };
    const errors: Record<string, string[]> = {};
    for (const issue of zodError.errors) {
      const path = issue.path.join(".") || "non_field_errors";
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(issue.message);
    }
    return c.json(errors, 400);
  }

  // Default 500 error
  return c.json(
    {
      detail:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred."
          : err.message,
    },
    500
  );
}

// Helper to throw HTTP errors
export function httpError(status: number, message: string): never {
  throw new HTTPException(status as 400 | 401 | 403 | 404 | 500, { message });
}
