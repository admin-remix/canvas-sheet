import { DataType, ColumnSchema, SelectOption } from './types';

/** Basic logger utility */
export function log(type: 'log' | 'warn' | 'error', verbose: boolean, ...args: any[]): void {
    if (!verbose && type !== 'error') return; // Only log errors if not verbose
    console[type](...args);
}

/** Format cell value for display */
export function formatValue(value: any, type?: DataType, selectOptions?: SelectOption[]): string {
    if (value === null || value === undefined) return "";

    switch (type) {
        case 'date':
            try {
                // Handle both Date objects and ISO-like strings (YYYY-MM-DD)
                // Add time component and specify UTC to avoid timezone issues during parsing
                const dateStr = String(value);
                const date = value instanceof Date ? value : new Date(dateStr.includes('T') ? dateStr : dateStr + "T00:00:00Z");
                if (!isNaN(date.getTime())) {
                    // Use locale-specific date format
                    return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
                }
            } catch (e) {
                // Ignore formatting errors for date
                log('warn', false, "Error formatting date value:", value, e);
            }
            return String(value); // Fallback to string representation
        case 'boolean':
            return value === true ? "True" : value === false ? "False" : "";
        case 'select':
            if (selectOptions) {
                const selectedOption = selectOptions.find(v => v.id === value);
                return selectedOption ? selectedOption.name : "";
            }
            return ""; // Fallback if no options provided
        case 'number':
            // Potentially format numbers (e.g., locale-specific separators, precision)
            // For now, just convert to string
             return String(value);
        case 'text':
        case 'email':
        default:
            return String(value);
    }
}

/** Format cell value for input element */
export function formatValueForInput(value: any, type?: DataType): string {
    if (value === null || value === undefined) return "";

    if (type === 'date') {
        try {
            // Input type=date requires YYYY-MM-DD format
            const dateStr = String(value);
            const date = value instanceof Date ? value : new Date(dateStr.includes('T') ? dateStr : dateStr + "T00:00:00Z");
            if (!isNaN(date.getTime())) {
                // Extract parts from UTC date to avoid timezone shifts
                const year = date.getUTCFullYear();
                const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
                const day = date.getUTCDate().toString().padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        } catch (e) {
            log('warn', false, "Error formatting date for input:", value, e);
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
        case 'number':
            const num = parseFloat(value);
            return isNaN(num) ? null : num; // Return null if parsing fails
        case 'boolean':
            // This case is typically handled by dropdowns, but as a fallback:
            return value.toLowerCase() === 'true';
        case 'date':
            // Input type=date provides YYYY-MM-DD. Store as string.
            // Validation might be needed to ensure it's a valid date string.
            return value;
        case 'text':
        case 'email':
        default:
            return value;
    }
}

/** Validate input value against column schema */
export function validateInput(value: any, schemaCol: ColumnSchema | undefined, colKey: string, verbose: boolean): boolean {
    if (!schemaCol) return true; // No schema, always valid

    // Check required
    if (schemaCol.required && (value === null || value === undefined || value === "")) {
        log('warn', verbose, `Validation failed: Column "${colKey}" is required.`);
        return false;
    }

    // Skip further checks if value is null/empty and not required
    if (value === null || value === undefined || value === "") return true;

    // Check type-specific constraints
    switch (schemaCol.type) {
        case 'text':
            if (schemaCol.maxlength && typeof value === 'string' && value.length > schemaCol.maxlength) {
                log('warn', verbose, `Validation failed: Column "${colKey}" exceeds max length of ${schemaCol.maxlength}.`);
                return false;
            }
            break;
        case 'email':
            // Basic email regex (consider using a more robust library for production)
            if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                log('warn', verbose, `Validation failed: Invalid email format for column "${colKey}".`);
                return false;
            }
            break;
        case 'number':
             if (typeof value !== 'number') {
                log('warn', verbose, `Validation failed: Column "${colKey}" expects a number.`);
                return false;
            }
            if (schemaCol.decimal === false && !Number.isInteger(value)) {
                 log('warn', verbose, `Validation failed: Column "${colKey}" expects an integer.`);
                 return false;
            }
            // Add min/max checks if needed
             break;
        case 'date':
             // Check if it's a valid date string (YYYY-MM-DD)
             if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(new Date(value + "T00:00:00Z").getTime())) {
                log('warn', verbose, `Validation failed: Invalid date format (YYYY-MM-DD) for column "${colKey}".`);
                 return false;
             }
             break;
        case 'boolean':
             if (typeof value !== 'boolean') {
                 log('warn', verbose, `Validation failed: Column "${colKey}" expects a boolean.`);
                 return false;
             }
             break;
        case 'select':
            // Check if the value exists in the provided options (allow null for blank)
             if (value !== null && schemaCol.values && !schemaCol.values.some(opt => opt.id === value)) {
                 log('warn', verbose, `Validation failed: Invalid selection for column "${colKey}".`);
                 return false;
             }
             break;
    }

    return true; // All checks passed
} 