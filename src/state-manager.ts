// src/state-manager.ts

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
    ColumnSchema
} from './types';
import { DISABLED_FIELD_PREFIX } from './config';
import { log, validateInput } from './utils';

export class StateManager {
    private schema: SpreadsheetSchema;
    private columns: string[]; // Ordered list of column keys
    private data: DataRow[];
    private options: RequiredSpreadsheetOptions;

    // --- Core State ---
    private columnWidths: number[] = [];
    private rowHeights: number[] = [];
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
    private selectionEndCell: CellCoords | null = null;   // End cell of a multi-cell selection range
    private isDraggingSelection: boolean = false;

    private activeEditor: ActiveEditorState | null = null;
    private selectedRows: Set<number> = new Set();
    private lastClickedRow: number | null = null; // For shift-click selection range
    private copiedValue: any = undefined; // For single cell copy
    private copiedValueType: DataType | undefined = undefined;
    private copiedCell: CellCoords | null = null; // Tracks the source cell of single copy
    private copiedRangeData: any[][] | null = null; // For multi-cell copy
    private copiedSourceRange: { start: CellCoords, end: CellCoords } | null = null; // Source range of multi-cell copy
    private dragState: DragState = { isDragging: false, startCell: null, endRow: null };
    private resizeColumnState: ResizeColumnState = { isResizing: false, columnIndex: null, startX: null };
    private resizeRowState: ResizeRowState = { isResizing: false, rowIndex: null, startY: null };

    constructor(schema: SpreadsheetSchema, initialData: DataRow[], options: RequiredSpreadsheetOptions) {
        this.schema = schema;
        this.columns = Object.keys(schema);
        this.data = []; // Initialized properly in setInitialData
        this.options = options;
        // Initial data processing and size calculation is handled after construction
        // via setInitialData and subsequent dimension calculations
    }

    // --- Initialization ---
    public setInitialData(data: DataRow[]): void {
        // Deep copy data to prevent external modification issues
        this.data = JSON.parse(JSON.stringify(data || []));
        this._updateAllDisabledStates();
        // Initial size calculation will be done by DimensionCalculator
    }

    // --- Data Access / Modification ---

    public getData(): DataRow[] {
        // Return a deep copy to prevent direct modification of internal state
        // Exclude internal disabled fields
        return JSON.parse(JSON.stringify(this.data, (key, value) => {
            if (typeof key === 'string' && key.startsWith(DISABLED_FIELD_PREFIX)) {
                return undefined; // Omit disabled fields
            }
            return value;
        }));
    }

    public setData(newData: DataRow[]): void {
        // Used by the public API, performs deep copy and updates disabled states
        this.data = JSON.parse(JSON.stringify(newData || []));
        this._updateAllDisabledStates();
        this.resetInteractionState();
        // Recalculation of sizes, dimensions, and redraw is handled by Spreadsheet class
    }

    /** Internal method to update a single cell's value without validation (validation happens before) */
    public updateCellInternal(rowIndex: number, colIndex: number, value: any): void {
        if (rowIndex >= 0 && rowIndex < this.data.length && colIndex >= 0 && colIndex < this.columns.length) {
            const colKey = this.columns[colIndex];
            if (!this.data[rowIndex]) {
                this.data[rowIndex] = {};
            }
            this.data[rowIndex][colKey] = value;
            // Disabled state update should happen *after* the value change
            // this.updateDisabledStatesForRow(rowIndex); // Called separately after update
        } else {
            log('warn', this.options.verbose, `updateCellInternal: Invalid coordinates (${rowIndex}, ${colIndex})`);
        }
    }

    /** Public method to update a cell, includes validation */
    public updateCell(rowIndex: number, colKey: string, value: any): boolean {
        const colIndex = this.columns.indexOf(colKey);
        if (rowIndex >= 0 && rowIndex < this.data.length && colIndex !== -1) {
            const schemaCol = this.schema[colKey];
            if (validateInput(value, schemaCol, colKey, this.options.verbose)) {
                 if (!this.data[rowIndex]) {
                     this.data[rowIndex] = {};
                 }
                 if (this.data[rowIndex][colKey] !== value) {
                    this.data[rowIndex][colKey] = value;
                    this.updateDisabledStatesForRow(rowIndex); // Update disabled states after change
                    return true; // Indicate that an update occurred
                 }
            } else {
                log('warn', this.options.verbose, `updateCell: Validation failed for ${colKey}. Value not set.`);
            }
        } else {
            log('warn', this.options.verbose, `updateCell: Invalid row index (${rowIndex}) or column key (${colKey}).`);
        }
        return false; // No update occurred
    }

    public getCellData(rowIndex: number, colIndex: number): any {
        if (rowIndex < 0 || rowIndex >= this.data.length || colIndex < 0 || colIndex >= this.columns.length) {
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
                if (rowIndex < this.rowHeights.length) {
                    this.rowHeights.splice(rowIndex, 1);
                }
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
    public getColumnWidths(): number[] {
        return this.columnWidths;
    }

    public setColumnWidths(widths: number[]): void {
        this.columnWidths = widths;
    }

    public getRowHeights(): number[] {
        return this.rowHeights;
    }

    public setRowHeights(heights: number[]): void {
        this.rowHeights = heights;
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

    public updateVisibleRange(rowStart: number, rowEnd: number, colStart: number, colEnd: number): void {
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
        const changed = JSON.stringify(this.activeCell) !== JSON.stringify(coords);
        if (changed) {
             this.activeCell = coords;
        }
        return changed;
    }

    public getActiveEditor(): ActiveEditorState | null {
        return this.activeEditor;
    }

    public setActiveEditor(editorState: ActiveEditorState | null): void {
        this.activeEditor = editorState;
    }

    public getSelectedRows(): Set<number> {
        return this.selectedRows;
    }

    /** Sets selected rows. Returns true if the selected rows or last clicked row changed. */
    public setSelectedRows(rows: Set<number>, lastClicked: number | null): boolean {
        const rowsChanged = JSON.stringify(Array.from(this.selectedRows).sort()) !== JSON.stringify(Array.from(rows).sort());
        const lastClickedChanged = this.lastClickedRow !== lastClicked;
        const stateChanged = rowsChanged || lastClickedChanged;

        if (stateChanged) {
            this.selectedRows = rows;
            this.lastClickedRow = lastClicked;
        }
        return stateChanged;
    }

    public getLastClickedRow(): number | null {
        return this.lastClickedRow;
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
    public setCopiedValue(value: any, type: DataType | undefined, cell: CellCoords | null): boolean {
        const cellChanged = JSON.stringify(this.copiedCell) !== JSON.stringify(cell);
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
    public setCopiedRange(rangeData: any[][] | null, sourceRange: { start: CellCoords, end: CellCoords } | null ): boolean {
        const rangeDataChanged = JSON.stringify(this.copiedRangeData) !== JSON.stringify(rangeData);
        const sourceRangeChanged = JSON.stringify(this.copiedSourceRange) !== JSON.stringify(sourceRange);
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

    public getCopiedSourceRange(): { start: CellCoords, end: CellCoords } | null {
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
        this.lastClickedRow = null;
        this.copiedValue = undefined;
        this.copiedValueType = undefined;
        this.copiedCell = null;
        this.copiedRangeData = null;
        this.copiedSourceRange = null; // Reset source range
        this.dragState = { isDragging: false, startCell: null, endRow: null };
        this.resizeColumnState = { isResizing: false, columnIndex: null, startX: null };
        this.resizeRowState = { isResizing: false, rowIndex: null, startY: null };
    }

    // --- Cell Disabling Logic ---
    public isCellDisabled(rowIndex: number, colIndex: number): boolean {
        if (rowIndex < 0 || rowIndex >= this.data.length || colIndex < 0 || colIndex >= this.columns.length) {
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
            const newDisabledState = !!this.options.isCellDisabled(rowIndex, colKey, rowData);

            if (currentDisabledState !== newDisabledState) {
                rowData[disabledKey] = newDisabledState;
                changed = true;
            }
        });
        return changed;
    }

    /** Updates disabled states for all rows */
    private _updateAllDisabledStates(): void {
        log('log', this.options.verbose, "Updating all disabled states...");
        this.data.forEach((_, rowIndex) => {
            this.updateDisabledStatesForRow(rowIndex);
        });
        log('log', this.options.verbose, "Finished updating all disabled states.");
    }

    // --- Selection Range ---

    public getSelectionStartCell(): CellCoords | null {
        return this.selectionStartCell;
    }

    public getSelectionEndCell(): CellCoords | null {
        return this.selectionEndCell;
    }

    /** Sets the selection range start and end cells. Returns true if the range changed. */
    public setSelectionRange(startCell: CellCoords | null, endCell: CellCoords | null): boolean {
        const startChanged = JSON.stringify(this.selectionStartCell) !== JSON.stringify(startCell);
        const endChanged = JSON.stringify(this.selectionEndCell) !== JSON.stringify(endCell);
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
    public getNormalizedSelectionRange(): { start: CellCoords, end: CellCoords } | null {
        if (!this.selectionStartCell || !this.selectionEndCell || this.selectionStartCell.row === null || this.selectionStartCell.col === null || this.selectionEndCell.row === null || this.selectionEndCell.col === null) {
            return null;
        }
        const startRow = Math.min(this.selectionStartCell.row, this.selectionEndCell.row);
        const startCol = Math.min(this.selectionStartCell.col, this.selectionEndCell.col);
        const endRow = Math.max(this.selectionStartCell.row, this.selectionEndCell.row);
        const endCol = Math.max(this.selectionStartCell.col, this.selectionEndCell.col);
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
} 