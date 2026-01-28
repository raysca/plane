// Common types for the API

// Pagination
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
  total_pages: number;
  current_page: number;
  next_cursor?: string;
  prev_cursor?: string;
}

export interface PaginationParams {
  page?: number;
  per_page?: number;
  cursor?: string;
}

// API Response helpers
export interface ApiError {
  detail: string;
  code?: string;
}

export interface ValidationErrors {
  [field: string]: string[];
}

// Role types
export const ROLES = {
  GUEST: 5,
  VIEWER: 10,
  MEMBER: 15,
  ADMIN: 20,
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Priority types
export const PRIORITIES = {
  NONE: 0,
  URGENT: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
} as const;

export type Priority = (typeof PRIORITIES)[keyof typeof PRIORITIES];

// State groups
export const STATE_GROUPS = {
  BACKLOG: "backlog",
  UNSTARTED: "unstarted",
  STARTED: "started",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type StateGroup = (typeof STATE_GROUPS)[keyof typeof STATE_GROUPS];

// Module status
export const MODULE_STATUS = {
  BACKLOG: "backlog",
  PLANNED: "planned",
  IN_PROGRESS: "in-progress",
  PAUSED: "paused",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type ModuleStatus = (typeof MODULE_STATUS)[keyof typeof MODULE_STATUS];

// Issue relation types
export const RELATION_TYPES = {
  BLOCKS: "blocks",
  IS_BLOCKED_BY: "is_blocked_by",
  DUPLICATE_OF: "duplicate_of",
  RELATES_TO: "relates_to",
} as const;

export type RelationType = (typeof RELATION_TYPES)[keyof typeof RELATION_TYPES];

// Network/visibility types
export const NETWORK = {
  SECRET: 0,
  PUBLIC: 2,
} as const;

export type Network = (typeof NETWORK)[keyof typeof NETWORK];

// Access levels
export const ACCESS_LEVELS = {
  PRIVATE: 0,
  PROJECT: 1,
  WORKSPACE: 2,
} as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[keyof typeof ACCESS_LEVELS];

// Entity types for favorites/notifications
export type EntityType = "project" | "cycle" | "module" | "view" | "page" | "issue";

// Serialization helper type
export type Serialized<T> = {
  [K in keyof T as K extends string
    ? K extends `${infer First}${infer Rest}`
      ? Rest extends Capitalize<Rest>
        ? `${Lowercase<First>}_${Uncapitalize<Rest>}`
        : Lowercase<K>
      : Lowercase<K>
    : K]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends object
        ? Serialized<T[K]>
        : T[K];
};
