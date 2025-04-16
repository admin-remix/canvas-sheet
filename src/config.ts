import { RequiredSpreadsheetOptions } from './types';

export const DEFAULT_OPTIONS: RequiredSpreadsheetOptions = {
    defaultColumnWidth: 150,
    defaultRowHeight: 30,
    minColumnWidth: 50,
    maxColumnWidth: 500,
    minRowHeight: 20,
    maxRowHeight: 150,
    headerHeight: 35,
    rowNumberWidth: 50,
    font: "14px Inter, sans-serif",
    headerFont: "bold 14px Inter, sans-serif",
    padding: 5, // Default cell padding
    textAlign: 'left',
    textBaseline: 'middle',
    textColor: "#111827", // gray-900
    loadingTextColor: "#3b82f6", // blue-500
    errorTextColor: "#b91c1c", // red-700
    cellBgColor: "#ffffff", // Default white background for cells
    activeCellBgColor: "#eff6ff", // blue-50 - Background for the actively selected cell
    errorCellBgColor: "#fca5a5", // red-100
    selectedRowBgColor: "#f3f4f6", // gray-100 - Background for cells in selected rows
    selectedRangeBgColor: "#e0e7ff", // indigo-100 - Background for non-active cells in selection range
    headerTextColor: "#ffffff", // white
    selectedHeaderTextColor: "#000000", // black
    headerBgColor: "#4b5563", // gray-600
    customHeaderBgColor: "#9ca3af", // gray-300
    selectedHeaderBgColor: "#dbeafe", // gray-600
    headerClipText: true,
    headerTextAlign: 'center',
    gridLineColor: "#d1d5db", // gray-300
    rowNumberBgColor: "#f3f4f6", // gray-100
    selectedRowNumberBgColor: "#dbeafe", // blue-100
    disabledCellBgColor: "#e5e7eb", // gray-200
    disabledCellTextColor: "#9ca3af", // gray-400 (Corrected property name)
    highlightBorderColor: "#3b82f6", // blue-500
    fillHandleColor: "#3b82f6", // blue-500
    fillHandleSize: 10,
    dragRangeBorderColor: "#6b7280", // gray-500
    copyHighlightBorderColor: "#1f2937", // gray-800
    copyHighlightBorderDash: [4, 3], // Dash pattern (e.g., [dashLength, gapLength])
    resizeHandleSize: 5,
    verbose: false,
};

export const DISABLED_FIELD_PREFIX = "disabled:"; 