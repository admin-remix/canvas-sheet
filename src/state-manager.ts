import {
  SpreadsheetSchema,
  DataRow,
  RequiredSpreadsheetOptions,
  CellCoords,
  ActiveEditorState,
  DragState,
  ResizeColumnState,
  ResizeRowState,
  DataType,
  ColumnSchema,
  CellUpdateEvent,
  ValidationError,
  SelectOption,
} from "./types";
import { DISABLED_FIELD_PREFIX, ERROR_FIELD_PREFIX } from "./config";
import { log, validateInput } from "./utils";

export class StateManager {
  private schema: SpreadsheetSchema;
  private columns: string[]; // Ordered list of column keys
  private data: DataRow[];
  private options: RequiredSpreadsheetOptions;

  // --- Core State ---
  private columnWidths: Map<number, number> = new Map();
  private rowHeights: Map<number, number> = new Map();
  private scrollTop: number = 0;
  private scrollLeft: number = 0;
  private viewportWidth: number = 0;
  private viewportHeight: number = 0;
  private totalContentWidth: number = 0;
  private totalContentHeight: number = 0;
  private visibleRowStartIndex: number = 0;
  private visibleRowEndIndex: number = 0;
  private visibleColStartIndex: number = 0;
  private visibleColEndIndex: number = 0;

  // --- Interaction State ---
  private activeCell: CellCoords | null = null; // Cell with primary focus, start of selection
  private selectionStartCell: CellCoords | null = null; // Start cell of a multi-cell selection range
  private selectionEndCell: CellCoords | null = null; // End cell of a multi-cell selection range
  private isDraggingSelection: boolean = false;

  private activeEditor: ActiveEditorState | null = null;
  private selectedRows: Set<number> = new Set();
  private lastClickedRow: number | null = null; // For shift-click selection range
  private selectedColumn: number | null = null; // For column selection
  private copiedValue: any = undefined; // For single cell copy
  private copiedValueType: DataType | undefined = undefined;
  private copiedCell: CellCoords | null = null; // Tracks the source cell of single copy
  private copiedRangeData: any[][] | null = null; // For multi-cell copy
  private copiedSourceRange: { start: CellCoords; end: CellCoords } | null =
    null; // Source range of multi-cell copy
  private dragState: DragState = {
    isDragging: false,
    startCell: null,
    endRow: null,
  };
  private resizeColumnState: ResizeColumnState = {
    isResizing: false,
    columnIndex: null,
    startX: null,
  };
  private resizeRowState: ResizeRowState = {
    isResizing: false,
    rowIndex: null,
    startY: null,
  };
  private asyncOperationCounter = -1;

  public cachedDropdownOptionsByColumn: Map<
    string,
    Map<string | number, string>
  > = new Map();

  constructor(schema: SpreadsheetSchema, options: RequiredSpreadsheetOptions) {
    this.options = options;
    this.data = [];
    // Initialize schema and columns
    this.schema = schema;
    this.columns = Object.keys(schema);
    this._addCachedDropdownOptions();
  }

  public setSchema(schema: SpreadsheetSchema): void {
    this.schema = schema;
    this.columns = Object.keys(schema);
    this.columnWidths = new Map();
    this._addCachedDropdownOptions();
  }

  public addCachedDropdownOptionForColumn(
    colKey: string,
    values?: SelectOption[]
  ): void {
    const schemaCol = this.schema[colKey];
    const valuesToUse = values || schemaCol.values;
    if (schemaCol.type !== "select" || !valuesToUse) return;
    const newOptions = new Map<string | number, string>(
      valuesToUse.map((option) => [option.id, option.name])
    );
    let existingOptions = this.cachedDropdownOptionsByColumn.get(colKey);
    if (existingOptions?.size) {
      existingOptions = new Map([...existingOptions, ...newOptions]);
    } else {
      existingOptions = newOptions;
    }
    this.cachedDropdownOptionsByColumn.set(colKey, existingOptions);
  }

  private _addCachedDropdownOptions(): void {
    const dropdownColumns = Object.keys(this.schema).filter(
      (key) => this.schema[key].type === "select"
    );
    if (!dropdownColumns.length) return;
    for (const colKey of dropdownColumns) {
      this.addCachedDropdownOptionForColumn(colKey);
    }
  }

  // --- Initialization ---
  public setInitialData(data: DataRow[]): void {
    // Deep copy data to prevent external modification issues
    this.data = JSON.parse(JSON.stringify(data || []));
    this._updateAllDisabledStates();
    // Initial size calculation will be done by DimensionCalculator
  }

  // --- Data Access / Modification ---
  public get dataLength(): number {
    return this.data.length;
  }
  public getData(): DataRow[] {
    // Return a deep copy to prevent direct modification of internal state
    // Exclude internal disabled fields
    return JSON.parse(
      JSON.stringify(this.data, (key, value) => {
        if (typeof key === "string" && key.startsWith(DISABLED_FIELD_PREFIX)) {
          return undefined; // Omit disabled fields
        }
        return value;
      })
    );
  }

  public setData(newData: DataRow[]): void {
    // Used by the public API, performs deep copy and updates disabled states
    this.data = JSON.parse(JSON.stringify(newData || []));
    this.rowHeights = new Map(); // Reset row heights
    this._updateAllDisabledStates();
    this.resetInteractionState();
    // Recalculation of sizes, dimensions, and redraw is handled by Spreadsheet class
  }

  public updateColumnSchema(colKey: string, schema: ColumnSchema): void {
    this.schema[colKey] = {
      ...this.schema[colKey],
      ...schema,
    };
    if (schema.values) {
      this.addCachedDropdownOptionForColumn(colKey, schema.values);
    }
    this._updateAllDisabledStates();
    this.resetInteractionState();
  }

  public clearAllSelections(): void {
    this.activeCell = null;
    this.selectionStartCell = null;
    this.selectionEndCell = null;
    this.isDraggingSelection = false;
    this.selectedRows = new Set();
    this.selectedColumn = null;
    this.lastClickedRow = null;
    this.copiedValue = undefined;
    this.copiedValueType = undefined;
    this.copiedCell = null;
  }

  /** Internal method to update a single cell's value without validation (validation happens before) */
  public updateCellInternal(
    rowIndex: number,
    colIndex: number,
    value: any
  ): any {
    if (
      rowIndex < 0 ||
      rowIndex >= this.data.length ||
      colIndex < 0 ||
      colIndex >= this.columns.length
    ) {
      log(
        "warn",
        this.options.verbose,
        `updateCellInternal: Invalid coordinates (${rowIndex}, ${colIndex})`
      );
      return;
    }
    const colKey = this.columns[colIndex];
    if (!this.data[rowIndex]) {
      this.data[rowIndex] = {};
    }
    const oldValue = this.data[rowIndex][colKey];
    this.data[rowIndex][colKey] = value;
    // Disabled state update should happen *after* the value change
    // this.updateDisabledStatesForRow(rowIndex); // Called separately after update
    return oldValue;
  }

  /** Public method to update a cell, includes validation */
  public updateCell(
    rowIndex: number,
    colKey: string,
    value: any,
    throwError: boolean = false
  ): boolean {
    if (rowIndex < 0 || rowIndex >= this.data.length) {
      log(
        "warn",
        this.options.verbose,
        `updateCell: Invalid row index (${rowIndex}).`
      );
      return false;
    }
    if (colKey.includes(":")) {
      this.data[rowIndex][colKey] = value; // No validation for custom fields
      return true; // update occurred
    }
    const colIndex = this.columns.indexOf(colKey);
    if (colIndex < 0) {
      log(
        "warn",
        this.options.verbose,
        `updateCell: Invalid column key (${colKey}).`
      );
      return false;
    }
    const schemaCol = this.schema[colKey];
    const validationResult = validateInput(
      value,
      schemaCol,
      colKey,
      this.cachedDropdownOptionsByColumn.get(colKey),
      this.options.verbose
    );
    if ("error" in validationResult) {
      log(
        "warn",
        this.options.verbose,
        `updateCell: Validation failed for ${colKey}. Value not set.`
      );
      if (throwError) {
        throw new ValidationError({
          errorMessage: validationResult.error,
          rowIndex: rowIndex,
          colKey: colKey,
          value: value,
          schema: schemaCol,
          errorType: validationResult.errorType,
        });
      }
    } else {
      if (!this.data[rowIndex]) {
        this.data[rowIndex] = {};
      }
      if (!colKey.includes(":")) {
        this.removeCellValue(rowIndex, `${ERROR_FIELD_PREFIX}${colKey}`);
      }
      if (this.data[rowIndex][colKey] !== value) {
        this.data[rowIndex][colKey] = value;
        this.updateDisabledStatesForRow(rowIndex); // Update disabled states after change
        return true; // Indicate that an update occurred
      }
    }
    return false; // No update occurred
  }

  public removeCellValue(rowIndex: number, colKey: string): boolean {
    if (rowIndex < 0 || rowIndex >= this.data.length) {
      log(
        "warn",
        this.options.verbose,
        `removeCellValue: Invalid coordinates (${rowIndex}, ${colKey}).`
      );
      return false;
    }
    const value = this.data[rowIndex]?.[colKey];
    delete this.data[rowIndex][colKey];
    return !!value;
  }

  public getCellData(rowIndex: number, colIndex: number): any {
    if (
      rowIndex < 0 ||
      rowIndex >= this.data.length ||
      colIndex < 0 ||
      colIndex >= this.columns.length
    ) {
      return undefined;
    }
    const colKey = this.columns[colIndex];
    return this.data[rowIndex]?.[colKey];
  }

  public getRowData(rowIndex: number): DataRow | undefined {
    return this.data[rowIndex];
  }

  public deleteRows(rowsToDelete: number[]): number {
    let deletedCount = 0;
    // Sort descending to avoid index issues during splicing
    const sortedRows = rowsToDelete.sort((a, b) => b - a);
    sortedRows.forEach((rowIndex) => {
      if (rowIndex >= 0 && rowIndex < this.data.length) {
        this.data.splice(rowIndex, 1);
        // Also remove corresponding height entry
        this.rowHeights.delete(rowIndex);
        deletedCount++;
      }
    });
    if (deletedCount > 0) {
      this._updateAllDisabledStates(); // Re-evaluate disabled states if necessary
    }
    return deletedCount;
  }

  // --- Schema and Columns ---
  public getSchema(): SpreadsheetSchema {
    return this.schema;
  }

  public getColumns(): string[] {
    return this.columns;
  }

  public getColumnKey(colIndex: number): string {
    return this.columns[colIndex];
  }

  public getSchemaForColumn(colIndex: number): ColumnSchema | undefined {
    const key = this.columns[colIndex];
    return key ? this.schema[key] : undefined;
  }

  // --- Dimensions and Sizing ---
  public getColumnWidths(): Map<number, number> {
    return this.columnWidths;
  }

  public setColumnWidths(widths: number[]): void {
    // Store only non-default values in the map
    this.columnWidths = new Map();
    widths.forEach((width, index) => {
      if (width !== this.options.defaultColumnWidth) {
        this.columnWidths.set(index, width);
      }
    });
  }

  /**
   * Gets the width for a specific column, using the default width if not specified
   */
  public getColumnWidth(colIndex: number): number {
    return this.columnWidths.get(colIndex) || this.options.defaultColumnWidth;
  }

  /**
   * Sets the width for a specific column
   */
  public setColumnWidth(colIndex: number, width: number): void {
    if (width === this.options.defaultColumnWidth) {
      // No need to store default widths
      this.columnWidths.delete(colIndex);
    } else {
      this.columnWidths.set(colIndex, width);
    }
  }

  public getTotalColumnWidth(): number {
    const defaultWidth = this.options.defaultColumnWidth;
    let totalWidth = this.columns.length * defaultWidth;
    // forEach on map iterates over the values
    this.columnWidths.forEach((width) => {
      totalWidth += width - defaultWidth;
    });
    return totalWidth;
  }

  public getRowHeights(): Map<number, number> {
    return this.rowHeights;
  }

  public getTotalRowHeight(): number {
    const defaultHeight = this.options.defaultRowHeight;
    let totalHeight = this.data.length * defaultHeight;
    // forEach on map iterates over the values
    this.rowHeights.forEach((height) => {
      totalHeight += height - defaultHeight;
    });
    return totalHeight;
  }

  /**
   * Gets the height for a specific row, using the default height if not specified
   */
  public getRowHeight(rowIndex: number): number {
    return this.rowHeights.get(rowIndex) || this.options.defaultRowHeight;
  }

  /**
   * Sets the height for a specific row
   */
  public setRowHeight(rowIndex: number, height: number): void {
    if (height === this.options.defaultRowHeight) {
      // No need to store default heights
      this.rowHeights.delete(rowIndex);
    } else {
      this.rowHeights.set(rowIndex, height);
    }
  }

  public getTotalContentWidth(): number {
    return this.totalContentWidth;
  }

  public getTotalContentHeight(): number {
    return this.totalContentHeight;
  }

  public updateViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  public getViewportWidth(): number {
    return this.viewportWidth;
  }

  public getViewportHeight(): number {
    return this.viewportHeight;
  }

  public updateTotalContentSize(width: number, height: number): void {
    this.totalContentWidth = width;
    this.totalContentHeight = height;
  }

  // --- Scrolling and Viewport ---
  public updateScroll(top: number, left: number): void {
    this.scrollTop = top;
    this.scrollLeft = left;
  }

  public getScrollTop(): number {
    return this.scrollTop;
  }

  public getScrollLeft(): number {
    return this.scrollLeft;
  }

  public updateVisibleRange(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number
  ): void {
    this.visibleRowStartIndex = rowStart;
    this.visibleRowEndIndex = rowEnd;
    this.visibleColStartIndex = colStart;
    this.visibleColEndIndex = colEnd;
  }

  public getVisibleRowStartIndex(): number {
    return this.visibleRowStartIndex;
  }

  public getVisibleRowEndIndex(): number {
    return this.visibleRowEndIndex;
  }

  public getVisibleColStartIndex(): number {
    return this.visibleColStartIndex;
  }

  public getVisibleColEndIndex(): number {
    return this.visibleColEndIndex;
  }

  // --- Interaction State Management ---
  public getActiveCell(): CellCoords | null {
    return this.activeCell;
  }

  /** Sets the active cell. Returns true if the active cell changed. */
  public setActiveCell(coords: CellCoords | null): boolean {
    const changed =
      (!this.activeCell && coords) ||
      (this.activeCell && !coords) ||
      this.activeCell?.row !== coords?.row ||
      this.activeCell?.col !== coords?.col;
    if (changed) {
      this.activeCell = coords;
    }
    if (this.options.onCellSelected && coords?.col && coords?.row) {
      setTimeout(() => {
        try {
          this.options.onCellSelected!({
            rowIndex: coords?.row!,
            colKey: this.getColumnKey(coords?.col!),
            rowData: this.data[coords?.row!], // TODO: sending by reference, not a deep copy
          });
        } catch (_error) {
          // Ignore errors in onCellSelected callback
        }
      }, 0);
    }
    return !!changed;
  }

  public getActiveEditor(): ActiveEditorState | null {
    return this.activeEditor;
  }

  public newAsyncJobId(): number {
    this.asyncOperationCounter = (this.asyncOperationCounter + 1) % 1000000;
    return this.asyncOperationCounter;
  }
  public get currentAsyncJobId(): number {
    return this.asyncOperationCounter;
  }

  public setActiveEditor(editorState: ActiveEditorState | null): void {
    if (!editorState) {
      this.activeEditor = null;
    } else {
      this.activeEditor = { ...editorState, asyncJobId: this.newAsyncJobId() };
    }
  }

  public getSelectedRows(): Set<number> {
    return this.selectedRows;
  }

  /** Sets selected rows. Returns true if the selected rows or last clicked row changed. */
  public setSelectedRows(
    rows: Set<number>,
    lastClicked: number | null
  ): boolean {
    // Only update if the selection state actually changed
    const currentJson = JSON.stringify(
      Array.from(this.selectedRows).sort((a, b) => a - b)
    );
    const newJson = JSON.stringify(Array.from(rows).sort((a, b) => a - b));
    const selectedChanged = currentJson !== newJson;
    const lastClickedChanged = this.lastClickedRow !== lastClicked;
    const changed = selectedChanged || lastClickedChanged;

    if (changed) {
      this.selectedRows = new Set(rows);
      this.lastClickedRow = lastClicked;
    }
    return changed;
  }

  public getLastClickedRow(): number | null {
    return this.lastClickedRow;
  }

  public getSelectedColumn(): number | null {
    return this.selectedColumn;
  }

  public setSelectedColumn(column: number | null): boolean {
    const changed = this.selectedColumn !== column;
    if (changed) {
      this.selectedColumn = column;
    }
    return changed;
  }

  public getCopiedValue(): any {
    return this.copiedValue;
  }

  public getCopiedValueType(): DataType | undefined {
    return this.copiedValueType;
  }

  public getCopiedCell(): CellCoords | null {
    return this.copiedCell;
  }

  /** Sets the copied value (for single cell). Clears any copied range. Returns true if state changed. */
  public setCopiedValue(
    value: any,
    type: DataType | undefined,
    cell: CellCoords | null
  ): boolean {
    const cellChanged =
      JSON.stringify(this.copiedCell) !== JSON.stringify(cell);
    const rangeCleared = this.copiedRangeData !== null;
    const sourceRangeCleared = this.copiedSourceRange !== null;
    this.copiedValue = value;
    this.copiedValueType = type;
    this.copiedCell = cell;
    this.copiedRangeData = null; // Clear range data
    this.copiedSourceRange = null; // Clear source range
    return cellChanged || rangeCleared || sourceRangeCleared;
  }

  /** Sets the copied range data and source. Clears any single copied cell. Returns true if state changed. */
  public setCopiedRange(
    rangeData: any[][] | null,
    sourceRange: { start: CellCoords; end: CellCoords } | null
  ): boolean {
    const rangeDataChanged =
      JSON.stringify(this.copiedRangeData) !== JSON.stringify(rangeData);
    const sourceRangeChanged =
      JSON.stringify(this.copiedSourceRange) !== JSON.stringify(sourceRange);
    const cellCleared = this.copiedCell !== null;
    this.copiedRangeData = rangeData;
    this.copiedSourceRange = sourceRange;
    this.copiedValue = undefined;
    this.copiedValueType = undefined;
    this.copiedCell = null; // Clear single cell data
    return rangeDataChanged || sourceRangeChanged || cellCleared;
  }

  public getCopiedRangeData(): any[][] | null {
    return this.copiedRangeData;
  }

  public getCopiedSourceRange(): { start: CellCoords; end: CellCoords } | null {
    return this.copiedSourceRange;
  }

  /** Returns true if either a single cell or a range is copied */
  public isCopyActive(): boolean {
    return this.copiedCell !== null || this.copiedRangeData !== null;
  }

  /** Clears all copy state (single cell and range). Returns true if state changed. */
  public clearCopyState(): boolean {
    const cellCleared = this.setCopiedValue(undefined, undefined, null);
    // setCopiedValue already clears range data and source range
    // const rangeCleared = this.setCopiedRange(null, null); // No longer needed
    return cellCleared;
  }

  public getDragState(): DragState {
    return this.dragState;
  }

  public setDragState(state: DragState): void {
    this.dragState = state;
  }

  public isDraggingFillHandle(): boolean {
    return this.dragState.isDragging;
  }

  public getDragStartCell(): CellCoords | null {
    return this.dragState.startCell;
  }

  public getDragEndRow(): number | null {
    return this.dragState.endRow;
  }

  public getResizeColumnState(): ResizeColumnState {
    return this.resizeColumnState;
  }

  public setResizeColumnState(state: ResizeColumnState): void {
    this.resizeColumnState = state;
  }

  public getResizeRowState(): ResizeRowState {
    return this.resizeRowState;
  }

  public setResizeRowState(state: ResizeRowState): void {
    this.resizeRowState = state;
  }

  public isResizing(): boolean {
    return this.resizeColumnState.isResizing || this.resizeRowState.isResizing;
  }

  public resetInteractionState(): void {
    this.activeCell = null;
    this.selectionStartCell = null;
    this.selectionEndCell = null;
    this.isDraggingSelection = false;
    this.activeEditor = null;
    this.selectedRows = new Set();
    this.selectedColumn = null;
    this.lastClickedRow = null;
    this.copiedValue = undefined;
    this.copiedValueType = undefined;
    this.copiedCell = null;
    this.copiedRangeData = null;
    this.copiedSourceRange = null;
    this.dragState = { isDragging: false, startCell: null, endRow: null };
    this.resizeColumnState = {
      isResizing: false,
      columnIndex: null,
      startX: null,
    };
    this.resizeRowState = { isResizing: false, rowIndex: null, startY: null };
  }

  // --- Cell Disabling Logic ---
  public isCellDisabled(rowIndex: number, colIndex: number): boolean {
    if (
      rowIndex < 0 ||
      rowIndex >= this.data.length ||
      colIndex < 0 ||
      colIndex >= this.columns.length
    ) {
      return true; // Out of bounds is considered disabled
    }
    const colKey = this.columns[colIndex];
    const rowData = this.data[rowIndex];
    // Check the pre-calculated disabled field first
    return !!rowData?.[`${DISABLED_FIELD_PREFIX}${colKey}`];
  }

  /** Updates the internal disabled state fields for a specific row based on the isCellDisabled callback */
  public updateDisabledStatesForRow(rowIndex: number): boolean {
    if (rowIndex < 0 || rowIndex >= this.data.length) return false;
    const rowData = this.data[rowIndex];
    if (!rowData) return false;

    let changed = false;
    this.columns.forEach((colKey) => {
      const disabledKey = `${DISABLED_FIELD_PREFIX}${colKey}`;
      const currentDisabledState = !!rowData[disabledKey];
      // Use the user-provided function to determine the new state
      const schemaCol = this.schema[colKey];
      const newDisabledState = schemaCol?.disabled
        ? schemaCol.disabled(rowData, rowIndex)
        : false;

      if (currentDisabledState !== newDisabledState) {
        rowData[disabledKey] = newDisabledState;
        changed = true;
      }
    });
    return changed;
  }

  public callOnCellsUpdate(rows: CellUpdateEvent[]): void {
    this.options.onCellsUpdate?.(rows);
  }

  /** Updates disabled states for all rows */
  private _updateAllDisabledStates(): void {
    log("log", this.options.verbose, "Updating all disabled states...");
    for (let rowIndex = 0; rowIndex < this.data.length; rowIndex++) {
      this.updateDisabledStatesForRow(rowIndex);
    }
    log("log", this.options.verbose, "Finished updating all disabled states.");
  }

  // --- Selection Range ---

  public getSelectionStartCell(): CellCoords | null {
    return this.selectionStartCell;
  }

  public getSelectionEndCell(): CellCoords | null {
    return this.selectionEndCell;
  }

  /** Sets the selection range start and end cells. Returns true if the range changed. */
  public setSelectionRange(
    startCell: CellCoords | null,
    endCell: CellCoords | null
  ): boolean {
    const startChanged =
      JSON.stringify(this.selectionStartCell) !== JSON.stringify(startCell);
    const endChanged =
      JSON.stringify(this.selectionEndCell) !== JSON.stringify(endCell);
    const changed = startChanged || endChanged;

    if (changed) {
      this.selectionStartCell = startCell;
      this.selectionEndCell = endCell;
    }
    return changed;
  }

  /** Clears the multi-cell selection range */
  public clearSelectionRange(): boolean {
    return this.setSelectionRange(null, null);
  }

  /** Gets the currently selected range, normalized (top-left, bottom-right) */
  public getNormalizedSelectionRange(): {
    start: CellCoords;
    end: CellCoords;
  } | null {
    if (
      !this.selectionStartCell ||
      !this.selectionEndCell ||
      this.selectionStartCell.row === null ||
      this.selectionStartCell.col === null ||
      this.selectionEndCell.row === null ||
      this.selectionEndCell.col === null
    ) {
      return null;
    }
    const startRow = Math.min(
      this.selectionStartCell.row,
      this.selectionEndCell.row
    );
    const startCol = Math.min(
      this.selectionStartCell.col,
      this.selectionEndCell.col
    );
    const endRow = Math.max(
      this.selectionStartCell.row,
      this.selectionEndCell.row
    );
    const endCol = Math.max(
      this.selectionStartCell.col,
      this.selectionEndCell.col
    );
    return {
      start: { row: startRow, col: startCol },
      end: { row: endRow, col: endCol },
    };
  }

  public isMultiCellSelectionActive(): boolean {
    return !!this.selectionStartCell && !!this.selectionEndCell;
  }

  public setDraggingSelection(isDragging: boolean): void {
    this.isDraggingSelection = isDragging;
  }

  public getIsDraggingSelection(): boolean {
    return this.isDraggingSelection;
  }

  public addRow(): number {
    // Create an empty row based on the schema
    const newRow: DataRow = {};

    // Initialize each column with default values based on data type
    this.columns.forEach((colKey) => {
      if (colKey.includes(DISABLED_FIELD_PREFIX)) {
        return;
      }
      const columnSchema = this.schema[colKey];
      if (columnSchema?.defaultValue !== undefined) {
        newRow[colKey] = columnSchema.defaultValue;
        return;
      }

      // Set appropriate default values based on data type
      let defaultValue = null;
      if (columnSchema) {
        switch (columnSchema.type) {
          case "text":
          case "email":
            defaultValue = "";
            break;
          case "number":
            defaultValue = 0;
            break;
          case "boolean":
            defaultValue = false;
            break;
          default:
            defaultValue = null;
        }
      }

      newRow[colKey] = defaultValue;
    });

    // Add the new row to the data array
    this.data.push(newRow);

    // Update disabled states for the new row
    const newRowIndex = this.data.length - 1;
    this.updateDisabledStatesForRow(newRowIndex);

    // Return the index of the newly added row
    return newRowIndex;
  }

  public addColumn(fieldName: string, colSchema: ColumnSchema): number {
    if (this.schema[fieldName]) {
      throw new Error(`Column ${fieldName} already exists`);
    }
    const newColIndex = this.columns.length;
    this.columns.push(fieldName);
    // No need to store default column width
    this.schema[fieldName] = colSchema;
    this.addCachedDropdownOptionForColumn(fieldName);
    return newColIndex;
  }

  public removeColumn(colIndex: number): void {
    const colKey = this.columns[colIndex];
    this.clearAllSelections();
    delete this.schema[colKey];
    this.columns.splice(colIndex, 1);
    this.columnWidths.delete(colIndex);
    this.data.forEach((row) => {
      delete row[colKey];
    });
    this.cachedDropdownOptionsByColumn.delete(colKey);
  }
}
