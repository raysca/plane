import { z } from "zod";

// Common validation schemas

/**
 * CUID2 ID validation
 */
export const idSchema = z.string().min(1).max(32);

/**
 * Pagination query params
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * Common filter params
 */
export const filterSchema = z.object({
  order_by: z.string().optional(),
  search: z.string().optional(),
  created_at__gte: z.string().datetime().optional(),
  created_at__lte: z.string().datetime().optional(),
  updated_at__gte: z.string().datetime().optional(),
  updated_at__lte: z.string().datetime().optional(),
});

/**
 * Workspace slug validation
 */
export const workspaceSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format");

/**
 * Project identifier validation
 */
export const projectIdentifierSchema = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[A-Z][A-Z0-9]*$/, "Identifier must be uppercase alphanumeric");

/**
 * Email validation
 */
export const emailSchema = z.string().email();

/**
 * Password validation
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

/**
 * URL validation
 */
export const urlSchema = z.string().url();

/**
 * Color validation (hex)
 */
export const colorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color");

/**
 * Priority validation
 */
export const prioritySchema = z.coerce.number().int().min(0).max(4);

/**
 * Role validation
 */
export const roleSchema = z.coerce.number().int().refine(
  (val) => [5, 10, 15, 20].includes(val),
  "Invalid role value"
);

/**
 * State group validation
 */
export const stateGroupSchema = z.enum([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);

/**
 * Module status validation
 */
export const moduleStatusSchema = z.enum([
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
]);

/**
 * Relation type validation
 */
export const relationTypeSchema = z.enum([
  "blocks",
  "is_blocked_by",
  "duplicate_of",
  "relates_to",
]);

/**
 * Date only validation (YYYY-MM-DD)
 */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)");

/**
 * Sort order validation
 */
export const sortOrderSchema = z.coerce.number().positive();

/**
 * Boolean string validation (for query params)
 */
export const booleanStringSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((val) => val === "true" || val === "1");

/**
 * Comma-separated IDs validation
 */
export const commaSeparatedIdsSchema = z
  .string()
  .transform((val) => val.split(",").filter((id) => id.trim().length > 0))
  .pipe(z.array(idSchema));

/**
 * Issue filter schema
 */
export const issueFilterSchema = z.object({
  state: z.string().optional(),
  priority: prioritySchema.optional(),
  assignees: z.string().optional(),
  labels: z.string().optional(),
  parent: z.string().optional(),
  start_date: dateOnlySchema.optional(),
  target_date: dateOnlySchema.optional(),
  created_at__gte: z.string().optional(),
  created_at__lte: z.string().optional(),
  order_by: z.string().optional(),
  group_by: z.string().optional(),
  cursor: z.string().optional(),
  per_page: z.coerce.number().int().positive().max(100).default(50),
});

/**
 * Bulk operation schema
 */
export const bulkOperationSchema = z.object({
  issue_ids: z.array(idSchema).min(1).max(100),
  properties: z.record(z.string(), z.unknown()),
});
