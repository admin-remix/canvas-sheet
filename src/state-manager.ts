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
import { HistoryManager, HistoryAction } from "./history-manager";

export class StateManager {
  private schema: SpreadsheetSchema;
  private columns: string[];
  private data: DataRow[];
  private options: RequiredSpreadsheetOptions;
  private readonly historyManager: HistoryManager;

  // --- Core State ---
  private columnWidths: Map<number, number> = new Map();
  private rowHeights: Map<number, number> = new Map();
  private userResizedRows: Map<number, boolean> = new Map();
  // ... (other state properties from previous version) ...
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
  private activeCell: CellCoords | null = null; 
  private selectionStartCell: CellCoords | null = null; 
  private selectionEndCell: CellCoords | null = null; 
  private isDraggingSelection: boolean = false;
  private activeEditor: ActiveEditorState | null = null;
  private selectedRows: Set<number> = new Set();
  private lastClickedRow: number | null = null; 
  private selectedColumn: number | null = null; 
  private copiedValue: any = undefined; 
  private copiedValueType: DataType | undefined = undefined;
  private copiedCell: CellCoords | null = null; 
  private copiedRangeData: any[][] | null = null; 
  private copiedSourceRange: { start: CellCoords; end: CellCoords } | null = null; 
  private dragState: DragState = { isDragging: false, startCell: null, endRow: null, };
  private resizeColumnState: ResizeColumnState = { isResizing: false, columnIndex: null, startX: null, };
  private resizeRowState: ResizeRowState = { isResizing: false, rowIndex: null, startY: null, };
  private asyncOperationCounter = -1;
  public cachedDropdownOptionsByColumn: Map< string, Map<string | number, string> > = new Map();


  constructor(
    schema: SpreadsheetSchema,
    options: RequiredSpreadsheetOptions,
    historyManager: HistoryManager
  ) {
    this.options = options;
    this.historyManager = historyManager;
    this.data = [];
    this.schema = schema;
    this.columns = Object.keys(schema);
    this._addCachedDropdownOptions();
  }

  public setInitialData(data: DataRow[]): void {
    this.data = JSON.parse(JSON.stringify(data || []));
    this._updateAllDisabledStates();
  }

  public get dataLength(): number {
    return this.data.length;
  }

  public getData(raw = false): DataRow[] {
    if (raw) {
      return this.data;
    }
    return JSON.parse(
      JSON.stringify(this.data, (key, value) => {
        if (typeof key === "string" && key.startsWith(DISABLED_FIELD_PREFIX)) {
          return undefined; 
        }
        return value;
      })
    );
  }

  public setData(newData: DataRow[], recordHistory: boolean = true): void {
    const oldData = recordHistory ? JSON.parse(JSON.stringify(this.data)) : null;
    this.data = JSON.parse(JSON.stringify(newData || []));
    this.rowHeights = new Map();
    this.userResizedRows = new Map();
    this._updateAllDisabledStates();
    this.resetInteractionState();
    
    if (recordHistory && oldData) { 
      this.historyManager.addAction({
        type: 'batch_cell_update', 
        payload: { oldValue: oldData, newValue: JSON.parse(JSON.stringify(this.data)) },
      });
    }
  }
  
  public updateColumnSchema(colKey: string, schema: ColumnSchema, recordHistory: boolean = true): void {
    // Not recording history for schema changes for now due to complexity
    // const oldSchema = recordHistory ? JSON.parse(JSON.stringify(this.schema[colKey])) : null;
    this.schema[colKey] = {
      ...this.schema[colKey],
      ...schema,
    };
    if (schema.values) {
      this.addCachedDropdownOptionForColumn(colKey, schema.values);
    }
    this._updateAllDisabledStates();
    this.resetInteractionState();
    // if (recordHistory && oldSchema) {
    //   this.historyManager.addAction({
    //     type: 'column_schema_update', // This type would need to be added to ActionType
    //     payload: { colKey, oldSchema, newSchema: JSON.parse(JSON.stringify(this.schema[colKey])) }
    //   });
    // }
  }

  updateCellInternal(rowIndex: number, colIndex: number, value: any): any {
    // This method does NOT record history. Callers are responsible.
    if (rowIndex < 0 || rowIndex >= this.data.length || colIndex < 0 || colIndex >= this.columns.length) {
      log("warn", this.options.verbose, `updateCellInternal: Invalid coordinates (${rowIndex}, ${colIndex})`);
      return;
    }
    const colKey = this.columns[colIndex];
    if (!this.data[rowIndex]) {
      this.data[rowIndex] = {};
    }
    const oldValue = this.data[rowIndex][colKey];
    this.data[rowIndex][colKey] = value;
    return oldValue;
  }

  public updateCell(
    rowIndex: number,
    colKey: string,
    value: any,
    throwError: boolean = false,
    recordHistory: boolean = true
  ): boolean {
    if (rowIndex < 0 || rowIndex >= this.data.length) {
      return false;
    }
    if (colKey.includes(":")) { 
      const oldValue = this.data[rowIndex][colKey];
      if (oldValue !== value) {
         this.data[rowIndex][colKey] = value;
         // No history for custom fields by default
      }
      return true;
    }
    const colIndex = this.columns.indexOf(colKey);
    if (colIndex < 0) {
      return false;
    }
    const schemaCol = this.schema[colKey];
    const validationResult = validateInput(value, schemaCol, colKey, this.cachedDropdownOptionsByColumn.get(colKey), this.options.verbose, this.data, rowIndex);
    if ("error" in validationResult) {
      if (throwError) {
        throw new ValidationError({ errorMessage: validationResult.error, rowIndex: rowIndex, colKey: colKey, value: value, schema: schemaCol, errorType: validationResult.errorType });
      }
    } else {
      if (!this.data[rowIndex]) {
        this.data[rowIndex] = {};
      }
      this.removeCellValue(rowIndex, `${ERROR_FIELD_PREFIX}${colKey}`); // No history for error field removal
      const oldValue = this.data[rowIndex][colKey];
      if (oldValue !== value) {
        this.data[rowIndex][colKey] = value;
        if (recordHistory) {
          this.historyManager.addAction({
            type: 'cell_update',
            payload: { rowIndex, colIndex, oldValue, newValue: value },
          });
        }
        this.updateDisabledStatesForRow(rowIndex);
        return true;
      }
    }
    return false;
  }
  
  public deleteRows(rowsToDelete: number[], recordHistory: boolean = true): { deletedCount: number; deletedData: DataRow[] } {
    let deletedCount = 0;
    const deletedRowDetails: { rowIndex: number, rowData: DataRow }[] = [];
    const sortedRows = rowsToDelete.sort((a, b) => b - a);

    sortedRows.forEach((rowIndex) => {
      if (rowIndex >= 0 && rowIndex < this.data.length) {
        const rowData = JSON.parse(JSON.stringify(this.data[rowIndex])); // Always copy for return, record if needed
        if(recordHistory) deletedRowDetails.push({ rowIndex, rowData });
        this.data.splice(rowIndex, 1);
        this.rowHeights.delete(rowIndex);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      this._updateAllDisabledStates();
      if (recordHistory && deletedRowDetails.length > 0) {
        this.historyManager.addAction({
          type: 'delete_row',
          payload: { deletedRows: deletedRowDetails.sort((a,b) => a.rowIndex - b.rowIndex) }, 
        });
      }
    }
    return { deletedCount, deletedData: deletedRowDetails.map(d => d.rowData) }; // Return data regardless of history
  }
  
  public setColumnWidth(colIndex: number, width: number, recordHistory: boolean = true): void {
    const oldWidth = this.getColumnWidth(colIndex);
    if (oldWidth === width) return;

    if (width === this.options.defaultColumnWidth) {
      this.columnWidths.delete(colIndex);
    } else {
      this.columnWidths.set(colIndex, width);
    }
    if (recordHistory) {
      this.historyManager.addAction({
        type: 'column_resize',
        payload: { colIndex, oldSize: oldWidth, newSize: width },
      });
    }
  }

  public setRowHeight(rowIndex: number, height: number, recordHistory: boolean = true): void {
    const oldHeight = this.getRowHeight(rowIndex);
    height = Math.max(Math.min(height, this.options.maxRowHeight), this.options.minRowHeight);
    if (oldHeight === height) return;

    this.rowHeights.set(rowIndex, height);
    this.userResizedRows.set(rowIndex, true);
    if (recordHistory) {
      this.historyManager.addAction({
        type: 'row_resize',
        payload: { rowIndex, oldSize: oldHeight, newSize: height },
      });
    }
  }
  
  public addRow(recordHistory: boolean = true): { newRowIndex: number, newRowData: DataRow } {
    const newRow: DataRow = {};
    this.columns.forEach((colKey) => {
      if (colKey.includes(DISABLED_FIELD_PREFIX)) return;
      const columnSchema = this.schema[colKey];
      newRow[colKey] = columnSchema?.defaultValue !== undefined 
        ? columnSchema.defaultValue 
        : (columnSchema?.type === "text" || columnSchema?.type === "email" ? "" :
           columnSchema?.type === "number" ? 0 :
           columnSchema?.type === "boolean" ? false : null);
    });

    const newRowIndex = this.data.length;
    this.data.push(newRow); // Actual data modification
    this.updateDisabledStatesForRow(newRowIndex);
    const newRowDataCopy = JSON.parse(JSON.stringify(newRow));

    if (recordHistory) {
      this.historyManager.addAction({
        type: 'add_row',
        payload: { rowIndex: newRowIndex, rowData: newRowDataCopy },
      });
    }
    return { newRowIndex, newRowData: newRowDataCopy };
  }

  public addColumn(fieldName: string, colSchema: ColumnSchema, recordHistory: boolean = true): { newColIndex: number, newColumnSchema: ColumnSchema } {
    if (this.schema[fieldName]) {
      throw new Error(`Column ${fieldName} already exists`);
    }
    const oldSchemaForHistory = recordHistory ? JSON.parse(JSON.stringify(this.schema)) : null;
    const oldColumnsForHistory = recordHistory ? [...this.columns] : null;
    const oldDataForHistory = recordHistory ? JSON.parse(JSON.stringify(this.data)) : null;

    const newColIndex = this.columns.length;
    this.columns.push(fieldName);
    this.schema[fieldName] = colSchema;
    this.addCachedDropdownOptionForColumn(fieldName);
    this.data.forEach(row => {
      row[fieldName] = colSchema?.defaultValue !== undefined 
        ? colSchema.defaultValue 
        : (colSchema?.type === "text" || colSchema?.type === "email" ? "" :
           colSchema?.type === "number" ? 0 :
           colSchema?.type === "boolean" ? false : null);
    });
    
    const newColumnSchemaCopy = JSON.parse(JSON.stringify(colSchema));
    if (recordHistory && oldSchemaForHistory && oldColumnsForHistory && oldDataForHistory) {
      this.historyManager.addAction({
        type: 'add_column',
        payload: { 
          colIndex: newColIndex, 
          columnSchema: newColumnSchemaCopy,
          oldSchemaState: { schema: oldSchemaForHistory, columns: oldColumnsForHistory, data: oldDataForHistory }
        },
      });
    }
    return { newColIndex, newColumnSchema: newColumnSchemaCopy };
  }

  public removeColumn(colIndex: number, recordHistory: boolean = true): { removedColKey: string, removedColumnSchema: ColumnSchema, removedColumnData: any[] } {
    const colKey = this.columns[colIndex];
    const oldSchemaForHistory = recordHistory ? JSON.parse(JSON.stringify(this.schema)) : null;
    const oldColumnsForHistory = recordHistory ? [...this.columns] : null;
    const oldDataForHistory = recordHistory ? JSON.parse(JSON.stringify(this.data)) : null;
    const oldColumnWidthsForHistory = recordHistory ? new Map(this.columnWidths) : null;

    const removedColumnSchema = JSON.parse(JSON.stringify(this.schema[colKey]));
    const removedColumnData = this.data.map(row => row[colKey]);

    this.clearAllSelections();
    delete this.schema[colKey];
    this.columns.splice(colIndex, 1);
    
    const newColWidths = new Map<number, number>();
    this.columnWidths.forEach((width, oldIdx) => {
        if (oldIdx > colIndex) newColWidths.set(oldIdx - 1, width);
        else if (oldIdx < colIndex) newColWidths.set(oldIdx, width);
    });
    this.columnWidths = newColWidths;
    // This line was problematic: this.columnWidths.delete(this.columns.length); 
    // It should not be needed if the map is rebuilt correctly.
    
    this.data.forEach((row) => { delete row[colKey]; });
    this.cachedDropdownOptionsByColumn.delete(colKey);

    if (recordHistory && oldSchemaForHistory && oldColumnsForHistory && oldDataForHistory && oldColumnWidthsForHistory) {
      this.historyManager.addAction({
        type: 'delete_column',
        payload: { 
          colIndex, 
          columnSchema: removedColumnSchema, 
          columnData: removedColumnData,
          oldSchemaState: { schema: oldSchemaForHistory, columns: oldColumnsForHistory, data: oldDataForHistory, columnWidths: oldColumnWidthsForHistory }
        },
      });
    }
    return { removedColKey: colKey, removedColumnSchema, removedColumnData };
  }
  public addCachedDropdownOptionForColumn( colKey: string, values?: SelectOption[] ): void { const schemaCol = this.schema[colKey]; const valuesToUse = values || schemaCol.values; if (schemaCol.type !== "select" || !valuesToUse) return; const newOptions = new Map<string | number, string>( valuesToUse.map((option) => [option.id, option.name]) ); let existingOptions = this.cachedDropdownOptionsByColumn.get(colKey); if (existingOptions?.size) { existingOptions = new Map([...existingOptions, ...newOptions]); } else { existingOptions = newOptions; } this.cachedDropdownOptionsByColumn.set(colKey, existingOptions); }
  private _addCachedDropdownOptions(): void { const dropdownColumns = Object.keys(this.schema).filter( (key) => this.schema[key].type === "select" ); if (!dropdownColumns.length) return; for (const colKey of dropdownColumns) { this.addCachedDropdownOptionForColumn(colKey); } }
  public clearAllSelections(): void { this.activeCell = null; this.selectionStartCell = null; this.selectionEndCell = null; this.isDraggingSelection = false; this.selectedRows = new Set(); this.selectedColumn = null; this.lastClickedRow = null; this.copiedValue = undefined; this.copiedValueType = undefined; this.copiedCell = null; this.copiedRangeData = null; this.copiedSourceRange = null; }
  public removeCellValue(rowIndex: number, colKey: string): boolean { if (rowIndex < 0 || rowIndex >= this.data.length) { return false; } const value = this.data[rowIndex]?.[colKey]; delete this.data[rowIndex][colKey]; return !!value; }
  public getCellData(rowIndex: number, colIndex: number): any { if ( rowIndex < 0 || rowIndex >= this.data.length || colIndex < 0 || colIndex >= this.columns.length ) { return undefined; } const colKey = this.columns[colIndex]; return this.data[rowIndex]?.[colKey]; }
  public getRowData(rowIndex: number): DataRow | undefined { return this.data[rowIndex]; }
  public getSchema(): SpreadsheetSchema { return this.schema; }
  public getColumns(): string[] { return this.columns; }
  public getColumnKey(colIndex: number): string { return this.columns[colIndex]; }
  public getSchemaForColumn(colIndex: number): ColumnSchema | undefined { const key = this.columns[colIndex]; return key ? this.schema[key] : undefined; }
  public getColumnWidths(): Map<number, number> { return this.columnWidths; }
  public getColumnWidth(colIndex: number): number { return this.columnWidths.get(colIndex) || this.options.defaultColumnWidth; }
  public getTotalColumnWidth(): number { let totalWidth = 0; for(let i=0; i< this.columns.length; i++){ totalWidth += this.getColumnWidth(i); } return totalWidth; }
  public getRowHeights(): Map<number, number> { return this.rowHeights; }
  public getTotalRowHeight(): number { let totalHeight = 0; for(let i=0; i < this.data.length; i++){ totalHeight += this.getRowHeight(i); } return totalHeight; }
  public getRowHeight(rowIndex: number): number { return this.rowHeights.get(rowIndex) || this.options.defaultRowHeight; }
  public setAutoRowHeight(rowIndex: number, height: number): void { height = Math.max( Math.min(height, this.options.maxRowHeight), this.options.minRowHeight ); if (this.rowHeights.get(rowIndex) !== height) { this.rowHeights.set(rowIndex, height); } }
  public getTotalContentWidth(): number { return this.totalContentWidth; }
  public getTotalContentHeight(): number { return this.totalContentHeight; }
  public updateViewportSize(width: number, height: number): void { this.viewportWidth = width; this.viewportHeight = height; }
  public getViewportWidth(): number { return this.viewportWidth; }
  public getViewportHeight(): number { return this.viewportHeight; }
  public updateTotalContentSize(width: number, height: number): void { this.totalContentWidth = width; this.totalContentHeight = height; }
  public updateScroll(top: number, left: number): void { this.scrollTop = top; this.scrollLeft = left; }
  public getScrollTop(): number { return this.scrollTop; }
  public getScrollLeft(): number { return this.scrollLeft; }
  public updateVisibleRange( rowStart: number, rowEnd: number, colStart: number, colEnd: number ): void { this.visibleRowStartIndex = rowStart; this.visibleRowEndIndex = rowEnd; this.visibleColStartIndex = colStart; this.visibleColEndIndex = colEnd; }
  public getVisibleRowStartIndex(): number { return this.visibleRowStartIndex; }
  public getVisibleRowEndIndex(): number { return this.visibleRowEndIndex; }
  public getVisibleColStartIndex(): number { return this.visibleColStartIndex; }
  public getVisibleColEndIndex(): number { return this.visibleColEndIndex; }
  public getVisibleRange(): { visibleRowStart: number; visibleRowEnd: number; visibleColStart: number; visibleColEnd: number; } { return { visibleRowStart: this.visibleRowStartIndex, visibleRowEnd: this.visibleRowEndIndex, visibleColStart: this.visibleColStartIndex, visibleColEnd: this.visibleColEndIndex, }; }
  public getActiveCell(): CellCoords | null { return this.activeCell; }
  public setActiveCell(coords: CellCoords | null): boolean { const changed = (!this.activeCell && coords) || (this.activeCell && !coords) || this.activeCell?.row !== coords?.row || this.activeCell?.col !== coords?.col; if (changed) { this.activeCell = coords; } if (this.options.onCellSelected && coords?.col != null && coords?.row != null) { setTimeout(() => { try { this.options.onCellSelected!({ rowIndex: coords?.row!, colKey: this.getColumnKey(coords?.col!), rowData: this.data[coords?.row!], }); } catch (_error) {} }, 0); } return !!changed; }
  public getActiveEditor(): ActiveEditorState | null { return this.activeEditor; }
  public newAsyncJobId(): number { this.asyncOperationCounter = (this.asyncOperationCounter + 1) % 1000000; return this.asyncOperationCounter; }
  public get currentAsyncJobId(): number { return this.asyncOperationCounter; }
  public setActiveEditor(editorState: ActiveEditorState | null): void { if (!editorState) { this.activeEditor = null; } else { this.activeEditor = { ...editorState, asyncJobId: this.newAsyncJobId() }; } }
  public getSelectedRows(): Set<number> { return this.selectedRows; }
  public setSelectedRows( rows: Set<number>, lastClicked: number | null ): boolean { const currentJson = JSON.stringify( Array.from(this.selectedRows).sort((a, b) => a - b) ); const newJson = JSON.stringify(Array.from(rows).sort((a, b) => a - b)); const selectedChanged = currentJson !== newJson; const lastClickedChanged = this.lastClickedRow !== lastClicked; const changed = selectedChanged || lastClickedChanged; if (changed) { this.selectedRows = new Set(rows); this.lastClickedRow = lastClicked; } return changed; }
  public getLastClickedRow(): number | null { return this.lastClickedRow; }
  public getSelectedColumn(): number | null { return this.selectedColumn; }
  public setSelectedColumn(column: number | null): boolean { const changed = this.selectedColumn !== column; if (changed) { this.selectedColumn = column; } return changed; }
  public getCopiedValue(): any { return this.copiedValue; }
  public getCopiedValueType(): DataType | undefined { return this.copiedValueType; }
  public getCopiedCell(): CellCoords | null { return this.copiedCell; }
  public setCopiedValue( value: any, type: DataType | undefined, cell: CellCoords | null ): boolean { const cellChanged = JSON.stringify(this.copiedCell) !== JSON.stringify(cell); const rangeCleared = this.copiedRangeData !== null; const sourceRangeCleared = this.copiedSourceRange !== null; this.copiedValue = value; this.copiedValueType = type; this.copiedCell = cell; this.copiedRangeData = null; this.copiedSourceRange = null; return cellChanged || rangeCleared || sourceRangeCleared; }
  public setCopiedRange( rangeData: any[][] | null, sourceRange: { start: CellCoords; end: CellCoords } | null ): boolean { const rangeDataChanged = JSON.stringify(this.copiedRangeData) !== JSON.stringify(rangeData); const sourceRangeChanged = JSON.stringify(this.copiedSourceRange) !== JSON.stringify(sourceRange); const cellCleared = this.copiedCell !== null; this.copiedRangeData = rangeData; this.copiedSourceRange = sourceRange; this.copiedValue = undefined; this.copiedValueType = undefined; this.copiedCell = null; return rangeDataChanged || sourceRangeChanged || cellCleared; }
  public getCopiedRangeData(): any[][] | null { return this.copiedRangeData; }
  public getCopiedSourceRange(): { start: CellCoords; end: CellCoords } | null { return this.copiedSourceRange; }
  public isCopyActive(): boolean { return this.copiedCell !== null || this.copiedRangeData !== null; }
  public clearCopyState(): boolean { const cellCleared = this.setCopiedValue(undefined, undefined, null); return cellCleared; }
  public getDragState(): DragState { return this.dragState; }
  public setDragState(state: DragState): void { this.dragState = state; }
  public isDraggingFillHandle(): boolean { return this.dragState.isDragging; }
  public getDragStartCell(): CellCoords | null { return this.dragState.startCell; }
  public getDragEndRow(): number | null { return this.dragState.endRow; }
  public getResizeColumnState(): ResizeColumnState { return this.resizeColumnState; }
  public setResizeColumnState(state: ResizeColumnState): void { this.resizeColumnState = state; }
  public getResizeRowState(): ResizeRowState { return this.resizeRowState; }
  public setResizeRowState(state: ResizeRowState): void { this.resizeRowState = state; }
  public isResizing(): boolean { return this.resizeColumnState.isResizing || this.resizeRowState.isResizing; }
  public resetInteractionState(): void { this.activeCell = null; this.selectionStartCell = null; this.selectionEndCell = null; this.isDraggingSelection = false; this.activeEditor = null; this.selectedRows = new Set(); this.selectedColumn = null; this.lastClickedRow = null; this.copiedValue = undefined; this.copiedValueType = undefined; this.copiedCell = null; this.copiedRangeData = null; this.copiedSourceRange = null; this.dragState = { isDragging: false, startCell: null, endRow: null }; this.resizeColumnState = { isResizing: false, columnIndex: null, startX: null, }; this.resizeRowState = { isResizing: false, rowIndex: null, startY: null }; }
  public isCellDisabled(rowIndex: number, colIndex: number): boolean { if ( rowIndex < 0 || rowIndex >= this.data.length || colIndex < 0 || colIndex >= this.columns.length ) { return true; } const colKey = this.columns[colIndex]; const rowData = this.data[rowIndex]; return !!rowData?.[`${DISABLED_FIELD_PREFIX}${colKey}`]; }
  public updateDisabledStatesForRow(rowIndex: number): boolean { if (rowIndex < 0 || rowIndex >= this.data.length) return false; const rowData = this.data[rowIndex]; if (!rowData) return false; let changed = false; this.columns.forEach((colKey) => { const disabledKey = `${DISABLED_FIELD_PREFIX}${colKey}`; const currentDisabledState = !!rowData[disabledKey]; const schemaCol = this.schema[colKey]; if (!schemaCol?.disabled) return; const newDisabledState = schemaCol.disabled(rowData, rowIndex); if (currentDisabledState !== newDisabledState) { rowData[disabledKey] = newDisabledState; changed = true; } }); return changed; }
  public callOnCellsUpdate(rows: CellUpdateEvent[]): void { this.options.onCellsUpdate?.(rows); }
  private _updateAllDisabledStates(): void { for (let rowIndex = 0; rowIndex < this.data.length; rowIndex++) { this.updateDisabledStatesForRow(rowIndex); } }
  public getSelectionStartCell(): CellCoords | null { return this.selectionStartCell; }
  public getSelectionEndCell(): CellCoords | null { return this.selectionEndCell; }
  public setSelectionRange( startCell: CellCoords | null, endCell: CellCoords | null ): boolean { const startChanged = JSON.stringify(this.selectionStartCell) !== JSON.stringify(startCell); const endChanged = JSON.stringify(this.selectionEndCell) !== JSON.stringify(endCell); const changed = startChanged || endChanged; if (changed) { this.selectionStartCell = startCell; this.selectionEndCell = endCell; } return changed; }
  public clearSelectionRange(): boolean { return this.setSelectionRange(null, null); }
  public getNormalizedSelectionRange(): { start: CellCoords; end: CellCoords; } | null { if ( !this.selectionStartCell || !this.selectionEndCell || this.selectionStartCell.row === null || this.selectionStartCell.col === null || this.selectionEndCell.row === null || this.selectionEndCell.col === null ) { return null; } const startRow = Math.min( this.selectionStartCell.row, this.selectionEndCell.row ); const startCol = Math.min( this.selectionStartCell.col, this.selectionEndCell.col ); const endRow = Math.max( this.selectionStartCell.row, this.selectionEndCell.row ); const endCol = Math.max( this.selectionStartCell.col, this.selectionEndCell.col ); return { start: { row: startRow, col: startCol }, end: { row: endRow, col: endCol }, }; }
  public isMultiCellSelectionActive(): boolean { return !!this.selectionStartCell && !!this.selectionEndCell; }
  public setDraggingSelection(isDragging: boolean): void { this.isDraggingSelection = isDragging; }
  public getIsDraggingSelection(): boolean { return this.isDraggingSelection; }
  public isRowUserResized(rowIndex: number): boolean { return this.userResizedRows.get(rowIndex) === true; }
  public getUserResizedRows(): Map<number, boolean> { return this.userResizedRows; }
}
