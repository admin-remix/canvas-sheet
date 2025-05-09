import { DataType, ColumnSchema, ValidationErrorType } from "./types";

/** Basic logger utility */
export function log(
  type: "log" | "warn" | "error",
  verbose: boolean,
  ...args: any[]
): void {
  if (!verbose && type !== "error") return; // Only log errors if not verbose
  console[type](...args);
}

/** Format cell value for display */
export function formatValue(
  value: any,
  type?: DataType,
  cachedDropdownOptions?: Map<string | number, string>
): string {
  if (value === null || value === undefined) return "";

  switch (type) {
    case "date":
      try {
        // Handle both Date objects and ISO-like strings (YYYY-MM-DD)
        // Add time component and specify UTC to avoid timezone issues during parsing
        const dateStr = String(value);
        const date =
          value instanceof Date
            ? value
            : new Date(
                dateStr.includes("T") ? dateStr : dateStr + "T00:00:00Z"
              );
        if (!isNaN(date.getTime())) {
          // Use locale-specific date format
          return date.toLocaleDateString(undefined, { timeZone: "UTC" });
        }
      } catch (e) {
        // Ignore formatting errors for date
        log("warn", false, "Error formatting date value:", value, e);
      }
      return String(value); // Fallback to string representation
    case "boolean":
      return value === true ? "True" : value === false ? "False" : "";
    case "select":
      if (cachedDropdownOptions) {
        // Handle multi-select (array of values)
        if (Array.isArray(value)) {
          if (value.length === 0) return "";

          // Format each selected item and join with commas
          return value
            .map((v) => cachedDropdownOptions.get(v) || "")
            .join(", ");
        }

        // Single-select (legacy support)
        const selectedOption = cachedDropdownOptions.get(value);
        return selectedOption ? selectedOption : "";
      }
      return ""; // Fallback if no options provided
    case "number":
      // Potentially format numbers (e.g., locale-specific separators, precision)
      // For now, just convert to string
      return String(value);
    case "text":
    case "email":
    default:
      return String(value);
  }
}

/** Format cell value for input element */
export function formatValueForInput(value: any, type?: DataType): string {
  if (value === null || value === undefined) return "";

  if (type === "date") {
    try {
      // Input type=date requires YYYY-MM-DD format
      const dateStr = String(value);
      const date =
        value instanceof Date
          ? value
          : new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00Z");
      if (!isNaN(date.getTime())) {
        // Extract parts from UTC date to avoid timezone shifts
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
        const day = date.getUTCDate().toString().padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      log("warn", false, "Error formatting date for input:", value, e);
    }
    return ""; // Return empty if formatting fails
  }
  // For other types, the default string representation is usually fine
  return String(value);
}

/** Parse value from input element based on type */
export function parseValueFromInput(value: string, type?: DataType): any {
  if (value === "") return null; // Treat empty input as null

  switch (type) {
    case "number":
      const num = parseFloat(value);
      return isNaN(num) ? null : num; // Return null if parsing fails
    case "boolean":
      // This case is typically handled by dropdowns, but as a fallback:
      return value.toLowerCase() === "true";
    case "date":
      // Input type=date provides YYYY-MM-DD. Store as string.
      // Validation might be needed to ensure it's a valid date string.
      return value;
    case "text":
    case "email":
    default:
      return value;
  }
}

// Helper function to get comparable value
function getComparableValue(val: any): string {
  if (val === null || val === undefined) return "";

  // For string values, use lowercase for case-insensitive comparison
  if (typeof val === "string") return val.toLowerCase();

  // Handle array values (e.g., for multi-select)
  if (Array.isArray(val)) {
    return [...val].sort().join("|");
  }

  // For other types, convert to string
  return String(val);
}

/** Validate input value against column schema */
export function validateInput(
  value: any,
  schemaCol: ColumnSchema | undefined,
  colKey: string,
  dropdownOptions: Map<string | number, string> | undefined,
  verbose: boolean,
  data: any[], // Data array for uniqueness validation
  rowIndex: number // Row index to exclude current row from uniqueness check
):
  | {
      success: boolean;
    }
  | {
      success: false;
      error: string;
      errorType: ValidationErrorType;
    } {
  if (!schemaCol) return { success: true }; // No schema, always valid
  const colLabel = schemaCol.label || colKey;
  // Check required
  if (
    schemaCol.required &&
    (value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0))
  ) {
    const error = `Column "${colLabel}" is required.`;
    log("warn", verbose, `Validation failed: ${error}.`);
    return { success: false, error, errorType: "required" };
  }

  // Skip further checks if value is null/empty and not required
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return { success: true };

  // Check uniqueness constraint if enabled
  if (
    schemaCol.unique &&
    data &&
    data.length > 0 &&
    value !== null &&
    value !== undefined
  ) {
    // Prepare the value we're checking for uniqueness
    const comparableValue = getComparableValue(value);

    // Check if this value already exists in other rows
    let isDuplicate = false;

    // First pass: populate the map with all values except current row
    for (let idx = 0; idx < data.length; idx++) {
      // Skip current row when building the map
      if (idx === rowIndex) continue;

      const rowValue = data[idx][colKey];
      const comparableRowValue = getComparableValue(rowValue);

      // For checking uniqueness, we only need to know if the value exists
      if (comparableRowValue === comparableValue) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      const error = `Value must be unique in column "${colLabel}".`;
      log("warn", verbose, `Validation failed: ${error}.`);
      return { success: false, error, errorType: "unique" };
    }
  }

  // Check type-specific constraints
  switch (schemaCol.type) {
    case "text":
      if (
        schemaCol.maxlength &&
        typeof value === "string" &&
        value.length > schemaCol.maxlength
      ) {
        const error = `Column "${colLabel}" exceeds max length of ${schemaCol.maxlength}.`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "maxlength" };
      }
      break;
    case "email":
      // Basic email regex (consider using a more robust library for production)
      if (
        typeof value !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ) {
        const error = `Invalid email format for column "${colLabel}".`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      break;
    case "number":
      if (typeof value !== "number") {
        const error = `Column "${colLabel}" expects a number.`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      if (schemaCol.decimal === false && !Number.isInteger(value)) {
        const error = `Column "${colLabel}" expects an integer.`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      // Add min/max checks if needed
      break;
    case "date":
      // Check if it's a valid date string (YYYY-MM-DD)
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        isNaN(new Date(value + "T00:00:00Z").getTime())
      ) {
        const error = `Invalid date format (YYYY-MM-DD) for column "${colLabel}".`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        const error = `Column "${colLabel}" expects a boolean.`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      break;
    case "select":
      // For multi-select, check each value in the array
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && dropdownOptions && !dropdownOptions.has(item)) {
            const error = `Invalid option "${item}" for column "${colLabel}".`;
            log("warn", verbose, `Validation failed: ${error}.`);
            return { success: false, error, errorType: "value" };
          }
        }
        return { success: true };
      }

      // Check if the value exists in the provided options (allow null for blank)
      if (value !== null && dropdownOptions && !dropdownOptions.has(value)) {
        const error = `Invalid option "${value}" for column "${colLabel}".`;
        log("warn", verbose, `Validation failed: ${error}.`);
        return { success: false, error, errorType: "value" };
      }
      break;
  }

  return { success: true };
}

export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>): void {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}
