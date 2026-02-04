/**
 * API client for making requests to the Bun server.
 * All paths are relative since frontend and API are served from the same origin.
 */

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "APIError";
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = response.statusText;
    let errorData: unknown;

    try {
      errorData = await response.json();
      if (typeof errorData === "object" && errorData && "message" in errorData) {
        errorMessage = (errorData as { message: string }).message;
      }
    } catch {
      // Response is not JSON, use status text
    }

    throw new APIError(response.status, errorMessage, errorData);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const apiClient = {
  get: <T>(path: string) => api<T>(path),

  post: <T>(path: string, data?: unknown) =>
    api<T>(path, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(path: string, data: unknown) =>
    api<T>(path, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  put: <T>(path: string, data: unknown) =>
    api<T>(path, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: <T>(path: string) =>
    api<T>(path, {
      method: "DELETE",
    }),
};
