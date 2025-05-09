export type DataType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "email";
export type Nullable<T> = T | null;

export interface SelectOption {
  id: string | number;
  name: string;
}

export interface ColumnSchema {
  type: DataType;
  label: string;
  values?: SelectOption[]; // For 'select' type
  decimal?: boolean; // For 'number' type (false means integer)
  // validations: TODO: more validations or zod schema support
  required?: boolean;
  maxlength?: number; // For 'text' type
  ///////////
  multiline?: boolean; // For 'text' type, as textarea
  multiple?: boolean; // For 'select' type, allows multiple selections
  disabled?: (rowData: DataRow, rowIndex: number) => boolean; // Optional dynamic disabling
  filterValues?: (
    rowData: DataRow,
    rowIndex: number
  ) => SelectOption[] | Promise<SelectOption[]>; // Optional dynamic filtering
  error?: string;
  loading?: boolean;
  nullable?: boolean;
  readonly?: boolean;
  removable?: boolean;
  placeholder?: string;
  formatter?: (value: any) => string | null;
  lazySearch?: boolean;
  defaultValue?: any;
  // styling
  wordWrap?: boolean;
  autoTrim?: boolean; // for text input, trims the value
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

export interface Position {
  x: number;
  y: number;
}

export interface CellBounds extends Position {
  width: number;
  height: number;
}

export interface ActiveEditorState {
  row: number;
  col: number;
  type?: DataType;
  originalValue: any;
  isCustomEditor?: boolean;
  asyncJobId?: number;
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

export interface VisibleCell {
  rowIndex: number;
  colKey: string;
}

export interface CellEvent extends VisibleCell {
  rowData: DataRow;
}
export interface CellEventWithBounds extends CellEvent {
  bounds: CellBounds;
}
export interface CellEventWithSearch extends CellEvent {
  searchTerm: string;
}
export type CellContextMenuEvent = CellEvent & Position;
export type RowNumberContextMenuEvent = { rowIndex: number } & Position;
export type ColumnHeaderContextMenuEvent = { colIndex: number } & Position;

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
  headerTextAlign?: "left" | "center" | "right";
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
  textAlign?: "left" | "center" | "right";
  copyHighlightBorderColor?: string;
  copyHighlightBorderDash?: number[];
  temporaryErrorTimeout?: number;
  customDatePicker?: boolean;
  autoAddNewRow?: boolean;
  autoResizeRowHeight?: boolean; // Whether to automatically resize row heights based on content
  lazySearchDebounceTime?: number;
  blankDropdownItemLabel?: string;
  allowTabInTextarea?: boolean;
  wrapText?: boolean;
  lineHeight?: number; // in pixels
  verbose?: boolean;

  onCellsUpdate?: Nullable<(rows: CellUpdateEvent[]) => void>;
  onCellSelected?: Nullable<(event: CellEvent) => void>;
  onEditorOpen?: Nullable<(event: CellEventWithBounds) => void>;
  onRowDeleted?: Nullable<(rows: DataRow[]) => void>;
  onColumnDelete?: Nullable<(colIndex: number, schema: ColumnSchema) => void>;
  onLazySearch?: Nullable<
    (event: CellEventWithSearch) => Promise<Nullable<SelectOption[]>>
  >;
  onCellContextMenu?: Nullable<(event: CellContextMenuEvent) => void>;
  onRowNumberContextMenu?: Nullable<(event: RowNumberContextMenuEvent) => void>;
  onColumnHeaderContextMenu?: Nullable<
    (event: ColumnHeaderContextMenuEvent) => void
  >;
}

export interface CellUpdateInput extends VisibleCell {
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

export type ValidationErrorType = "required" | "maxlength" | "value";

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
    errorType,
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
