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
    textColor: "#111827", // gray-900
    headerTextColor: "#ffffff", // white
    headerBgColor: "#4b5563", // gray-600
    gridLineColor: "#d1d5db", // gray-300
    rowNumberBgColor: "#f3f4f6", // gray-100
    selectedRowNumberBgColor: "#dbeafe", // blue-100
    disabledCellBgColor: "#e5e7eb", // gray-200
    disabledTextColor: "#9ca3af", // gray-400
    highlightBorderColor: "#3b82f6", // blue-500
    fillHandleColor: "#3b82f6", // blue-500
    fillHandleSize: 10,
    dragRangeBorderColor: "#6b7280", // gray-500
    resizeHandleSize: 5,
    isCellDisabled: (_rowIndex, _colKey, _rowData) => false,
    verbose: false,
};

export const DISABLED_FIELD_PREFIX = "disabled:"; 