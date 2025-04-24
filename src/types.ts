export type DataType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'email';
export type Nullable<T> = T | null;

export interface SelectOption {
    id: string | number;
    name: string;
}

export interface ColumnSchema {
    type: DataType;
    label: string;
    required?: boolean;
    values?: SelectOption[]; // For 'select' type
    decimal?: boolean;      // For 'number' type (false means integer)
    maxlength?: number;     // For 'text' type
    disabled?: (rowData: DataRow, rowIndex: number) => boolean; // Optional dynamic disabling
    filterValues?: (rowData: DataRow, rowIndex: number) => SelectOption[] | Promise<SelectOption[]>; // Optional dynamic filtering
    error?: string;
    loading?: boolean;
    nullable?: boolean;
    readonly?: boolean;
    removable?: boolean;
    placeholder?: string;
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
    isCustomEditor?: boolean;
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
    placeholderTextColor?: string;
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
    readonlyHeaderBgColor?: string;
    readonlyHeaderTextColor?: string;
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
    temporaryErrorTimeout?: number;
    customDatePicker?: boolean;
    autoAddNewRow?: boolean;
    verbose?: boolean;

    onCellsUpdate?: Nullable<(rows: CellUpdateEvent[]) => void>;
    onCellSelected?: Nullable<(rowIndex: number, colKey: string, rowData: DataRow) => void>;
    onEditorOpen?: Nullable<(rowIndex: number, colKey: string, rowData: DataRow, bounds: CellBounds) => void>;
    onRowDeleted?: Nullable<(rows: DataRow[]) => void>;
    onColumnDelete?: Nullable<(colIndex: number, schema: ColumnSchema) => void>;
}

export interface CellUpdateInput {
    rowIndex: number;
    colKey: string;
    value: any;
    flashError?: string;
}
export interface CellUpdateEvent {
    rowIndex: number;
    columnKeys: string[];
    data: DataRow;
    oldData?: DataRow;
}

// Required version of options for internal use
export type RequiredSpreadsheetOptions = Required<SpreadsheetOptions>;

export interface DropdownItem {
    id: any;
    name: string;
}

export type ValidationErrorType = 'required' | 'maxlength' | 'value';

export class ValidationError extends Error {
    rowIndex: number;
    colKey: string;
    value: any;
    schema: ColumnSchema;
    errorType: ValidationErrorType;
    constructor({
        errorMessage,
        rowIndex,
        colKey,
        value,
        schema,
        errorType
    }: {
        errorMessage: string;
        rowIndex: number;
        colKey: string;
        value: any;
        schema: ColumnSchema;
        errorType: ValidationErrorType;
    }) {
        super(errorMessage);
        this.rowIndex = rowIndex;
        this.colKey = colKey;
        this.value = value;
        this.schema = schema;
        this.errorType = errorType;
    }
}