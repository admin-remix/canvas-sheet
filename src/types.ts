// src/types.ts

export type DataType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'email';

export interface SelectOption {
    id: any;
    name: string;
}

export interface ColumnSchema {
    type: DataType;
    label?: string;
    required?: boolean;
    values?: SelectOption[]; // For 'select' type
    formatOptions?: any;    // e.g., { decimalPlaces: 2, locale: 'en-US' }
    decimal?: boolean;      // For 'number' type (false means integer)
    maxlength?: number;     // For 'text' type
    disabled?: (rowData: DataRow) => boolean; // Optional dynamic disabling
    error?: string;
    loading?: boolean;
}

export interface SpreadsheetSchema {
    [key: string]: ColumnSchema;
}

export interface DataRow {
    [key: string]: any; // Allows any value type initially
}

export interface CellCoords {
    row: number | null;
    col: number | null;
}

export interface CellBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ActiveEditorState {
    row: number;
    col: number;
    type?: DataType;
    originalValue: any;
}

export interface DragState {
    startCell: CellCoords | null;
    endRow: number | null;
    isDragging: boolean;
}

export interface ResizeColumnState {
    isResizing: boolean;
    columnIndex: number | null;
    startX: number | null;
}

export interface ResizeRowState {
    isResizing: boolean;
    rowIndex: number | null;
    startY: number | null;
}

export interface SpreadsheetOptions {
    defaultColumnWidth?: number;
    defaultRowHeight?: number;
    minColumnWidth?: number;
    maxColumnWidth?: number;
    minRowHeight?: number;
    maxRowHeight?: number;
    headerHeight?: number;
    rowNumberWidth?: number;
    font?: string;
    headerFont?: string;
    textColor?: string;
    loadingTextColor?: string;
    errorTextColor?: string;
    cellBgColor?: string; // Default cell background
    activeCellBgColor?: string; // Background for active (selected) cell
    errorCellBgColor?: string;
    selectedRowBgColor?: string; // Background for cells in selected rows
    selectedRangeBgColor?: string; // Background for cells in multi-select range (excluding active)
    headerTextColor?: string;
    selectedHeaderTextColor?: string;
    customHeaderBgColor?: string;
    headerBgColor?: string;
    selectedHeaderBgColor?: string;
    headerClipText?: boolean; // Clip text or adjust(squish) text width to fit the header
    headerTextAlign?: 'left' | 'center' | 'right';
    gridLineColor?: string;
    rowNumberBgColor?: string;
    selectedRowNumberBgColor?: string;
    disabledCellBgColor?: string;
    disabledCellTextColor?: string; // Text color for disabled cells
    highlightBorderColor?: string;
    fillHandleColor?: string;
    fillHandleSize?: number;
    dragRangeBorderColor?: string;
    resizeHandleSize?: number;
    padding?: number; // Internal padding for cell text
    textAlign?: 'left' | 'center' | 'right';
    textBaseline?: 'top' | 'middle' | 'bottom';
    copyHighlightBorderColor?: string;
    copyHighlightBorderDash?: number[];
    verbose?: boolean;
}

export interface CellUpdateEvent {
    index: number;
    data: any;
}

interface SpreadsheetEvents {
    isCellDisabled?: (rowIndex: number, colKey: string, rowData: DataRow) => boolean;
    onCellsUpdate?: (rows: CellUpdateEvent[]) => void;
}

// Required version of options for internal use
export type RequiredSpreadsheetOptions = Required<SpreadsheetOptions> & SpreadsheetEvents;

export interface DropdownItem {
    id: any;
    name: string;
} 