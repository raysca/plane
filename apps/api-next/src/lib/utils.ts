import type { PaginatedResponse, PaginationParams } from "../types";

/**
 * Generate a paginated response in DRF format
 */
export function paginate<T>(
  items: T[],
  total: number,
  params: PaginationParams,
  baseUrl: string
): PaginatedResponse<T> {
  const page = params.page ?? 1;
  const perPage = params.per_page ?? 50;
  const totalPages = Math.ceil(total / perPage);

  return {
    count: total,
    next: page < totalPages ? `${baseUrl}?page=${page + 1}&per_page=${perPage}` : null,
    previous: page > 1 ? `${baseUrl}?page=${page - 1}&per_page=${perPage}` : null,
    results: items,
    total_pages: totalPages,
    current_page: page,
  };
}

/**
 * Generate a cursor-based paginated response
 */
export function paginateCursor<T extends { id: string }>(
  items: T[],
  hasMore: boolean,
  params: PaginationParams
): {
  next: string | null;
  previous: string | null;
  results: T[];
  next_cursor: string | null;
  prev_cursor: string | null;
} {
  const lastItem = items[items.length - 1];
  return {
    next: null,
    previous: null,
    results: items,
    next_cursor: hasMore && lastItem ? lastItem.id : null,
    prev_cursor: params.cursor ?? null,
  };
}

/**
 * Convert camelCase to snake_case
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Transform object keys from camelCase to snake_case
 */
export function serializeKeys<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = toSnakeCase(key);

    if (value === null || value === undefined) {
      result[snakeKey] = value;
    } else if (value instanceof Date) {
      result[snakeKey] = value.toISOString();
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        typeof item === "object" && item !== null
          ? serializeKeys(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      result[snakeKey] = serializeKeys(value as Record<string, unknown>);
    } else {
      result[snakeKey] = value;
    }
  }

  return result;
}

/**
 * Transform object keys from snake_case to camelCase
 */
export function deserializeKeys<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = toCamelCase(key);

    if (value === null || value === undefined) {
      result[camelKey] = value;
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        typeof item === "object" && item !== null
          ? deserializeKeys(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      result[camelKey] = deserializeKeys(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }

  return result;
}

/**
 * Generate a slug from a string
 */
export function generateSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Check if a slug is valid
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/**
 * Generate a project identifier from name
 */
export function generateIdentifier(name: string, existingIdentifiers: string[] = []): string {
  // Take first 3-5 letters, uppercase
  let identifier = name
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 5)
    .toUpperCase();

  if (identifier.length < 2) {
    identifier = "PRJ";
  }

  // If identifier exists, append a number
  let counter = 1;
  let finalIdentifier = identifier;
  while (existingIdentifiers.includes(finalIdentifier)) {
    finalIdentifier = `${identifier}${counter}`;
    counter++;
  }

  return finalIdentifier;
}

/**
 * Calculate offset from page and per_page
 */
export function calculateOffset(page: number, perPage: number): number {
  return (page - 1) * perPage;
}

/**
 * Parse comma-separated IDs
 */
export function parseIds(ids: string | undefined): string[] {
  if (!ids) return [];
  return ids.split(",").filter((id) => id.trim().length > 0);
}

/**
 * Format date for API response
 */
export function formatDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

/**
 * Format date only (no time) for API response
 */
export function formatDateOnly(date: Date | null | undefined): string | null {
  if (!date) return null;
  const parts = date.toISOString().split("T");
  return parts[0] ?? null;
}

/**
 * Group array by key
 */
export function groupBy<T, K extends keyof T>(array: T[], key: K): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  for (const item of array) {
    const value = String(item[key]);
    if (!result[value]) {
      result[value] = [];
    }
    result[value].push(item);
  }

  return result;
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}
