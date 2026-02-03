import { db } from "../db";
import { projects } from "../db/schema/project";
import { eq } from "drizzle-orm";

/**
 * Convert datetime fields in a record/list to a target timezone.
 * Equivalent to Django's user_timezone_converter().
 */
export function userTimezoneConverter<T extends Record<string, unknown>>(
  data: T | T[],
  datetimeFields: string[],
  userTimezone: string
): T | T[] {
  const isSingle = !Array.isArray(data);
  const items = isSingle ? [data] : data;

  for (const item of items) {
    for (const field of datetimeFields) {
      if (field in item && item[field]) {
        const dt = item[field];
        if (dt instanceof Date) {
          // Format the date in the user's timezone
          item[field] = new Date(
            dt.toLocaleString("en-US", { timeZone: userTimezone })
          ) as unknown as T[keyof T];
        }
      }
    }
  }

  return isSingle ? items[0] : items;
}

/**
 * Convert a date string (YYYY-MM-DD) to UTC based on a project's timezone.
 * Equivalent to Django's convert_to_utc().
 *
 * For start dates: uses 00:00:01 in project timezone (or current time if today).
 * For end dates: uses 23:59:00 in project timezone.
 */
export async function convertToUtc(
  dateStr: string,
  projectId: string,
  isStartDate: boolean = false
): Promise<Date> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  // Workspace timezone is stored on the workspace, project inherits it
  // For now, projects don't have their own timezone field in api-next schema
  // so we use UTC as default (matching Django's project.timezone default)
  const projectTimezone = "UTC";

  if (!dateStr || !projectTimezone) {
    throw new Error("Both date and timezone must be provided.");
  }

  // Parse date parts
  const [year, month, day] = dateStr.split("-").map(Number);

  if (isStartDate) {
    // Start of day + 1 second in project timezone
    const localDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:01`;
    const localDate = dateInTimezone(localDateStr, projectTimezone);

    // If the date is today in the project timezone, return current UTC time
    const nowInProjectTz = new Date(
      new Date().toLocaleString("en-US", { timeZone: projectTimezone })
    );
    if (
      localDate.getFullYear() === nowInProjectTz.getFullYear() &&
      localDate.getMonth() === nowInProjectTz.getMonth() &&
      localDate.getDate() === nowInProjectTz.getDate()
    ) {
      return new Date();
    }

    return localDate;
  } else {
    // End of day (23:59:00) in project timezone
    const localDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:00`;
    return dateInTimezone(localDateStr, projectTimezone);
  }
}

/**
 * Convert a UTC datetime to a project's local timezone.
 * Equivalent to Django's convert_utc_to_project_timezone().
 */
export async function convertUtcToProjectTimezone(
  utcDatetime: Date,
  projectId: string
): Promise<Date> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  const projectTimezone = "UTC";

  if (!projectTimezone) {
    throw new Error("Project timezone must be provided.");
  }

  // Convert UTC to project timezone
  const localStr = utcDatetime.toLocaleString("en-US", { timeZone: projectTimezone });
  return new Date(localStr);
}

/**
 * Create a Date object representing a local datetime in a specific timezone,
 * converted to UTC for storage.
 */
function dateInTimezone(localDateTimeStr: string, timezone: string): Date {
  // Use Intl to figure out the offset, then adjust
  const tempDate = new Date(localDateTimeStr + "Z"); // treat as UTC temporarily

  // Get what this UTC time looks like in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // We need to find the UTC time such that when converted to the target timezone,
  // it matches localDateTimeStr. Use iterative approach:
  // offset = targetLocal - UTC
  const parts = formatter.formatToParts(tempDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";

  const tzYear = parseInt(get("year"));
  const tzMonth = parseInt(get("month")) - 1;
  const tzDay = parseInt(get("day"));
  let tzHour = parseInt(get("hour"));
  if (tzHour === 24) tzHour = 0;
  const tzMinute = parseInt(get("minute"));
  const tzSecond = parseInt(get("second"));

  const targetAsUtcMs = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond);
  const offsetMs = targetAsUtcMs - tempDate.getTime();

  // The desired UTC time = localDateTimeStr parsed as UTC - offset
  const localParts = localDateTimeStr.split("T");
  const [ly, lm, ld] = localParts[0].split("-").map(Number);
  const [lh, lmin, ls] = (localParts[1] || "00:00:00").split(":").map(Number);
  const localAsUtcMs = Date.UTC(ly, lm - 1, ld, lh, lmin, ls || 0);

  return new Date(localAsUtcMs - offsetMs);
}
