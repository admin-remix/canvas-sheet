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
    decimal?: boolean;      // For 'number' type (false means integer)
    maxlength?: number;     // For 'text' type
    disabled?: (rowData: DataRow) => boolean; // Optional dynamic disabling
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
    headerTextColor?: string;
    headerBgColor?: string;
    gridLineColor?: string;
    rowNumberBgColor?: string;
    selectedRowNumberBgColor?: string;
    disabledCellBgColor?: string;
    disabledTextColor?: string;
    highlightBorderColor?: string;
    fillHandleColor?: string;
    fillHandleSize?: number;
    dragRangeBorderColor?: string;
    resizeHandleSize?: number;
    isCellDisabled?: (rowIndex: number, colKey: string, rowData: DataRow) => boolean;
    verbose?: boolean;
}

// Required version of options for internal use
export type RequiredSpreadsheetOptions = Required<SpreadsheetOptions>;

export interface DropdownItem {
    id: any;
    name: string;
} 