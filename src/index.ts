import {
  SpreadsheetSchema,
  DataRow,
  SpreadsheetOptions,
  ColumnSchema,
  ValidationError,
  CellUpdateInput,
  VisibleCell,
  HistoryAction 
} from "./types";
import {
  DEFAULT_OPTIONS,
  ERROR_FIELD_PREFIX,
  LOADING_FIELD_PREFIX,
} from "./config";
import { DomManager } from "./dom-manager";
import { DimensionCalculator } from "./dimension-calculator";
import { Renderer } from "./renderer";
import { EventManager } from "./event-manager";
import { EditingManager } from "./editing-manager";
import { InteractionManager } from "./interaction-manager";
import { StateManager } from "./state-manager";
import { HistoryManager } from "./history-manager";
import { chunkArray, log } from "./utils";
export type * from "./types";
// import { Spreadsheet } from './index'; // Self-import removed, not strictly needed for 'this'

export class Spreadsheet {
  private container: HTMLElement;
  private options: Required<SpreadsheetOptions>;
  private stateManager: StateManager;
  private domManager: DomManager;
  private dimensionCalculator: DimensionCalculator;
  private renderer: Renderer;
  private eventManager: EventManager;
  private editingManager: EditingManager;
  private interactionManager: InteractionManager;
  private historyManager: HistoryManager;

  constructor(
    containerId: string,
    schema: SpreadsheetSchema,
    data: DataRow[] = [],
    options: SpreadsheetOptions = {}
  ) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element with ID "${containerId}" not found.`);
    }
    this.container = container;

    // Initialize options and managers in a logical order
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.historyManager = new HistoryManager(this.options.historyLimit);
    this.stateManager = new StateManager(schema, this.options, this.historyManager);
    this.domManager = new DomManager(this.container);
    this.dimensionCalculator = new DimensionCalculator(
      this.options,
      this.stateManager,
      this.domManager
    );
    this.renderer = new Renderer(
      this.domManager.getContext(),
      this.options,
      this.stateManager,
      this.dimensionCalculator
    );
    this.interactionManager = new InteractionManager(
      this.options,
      this.stateManager,
      this.renderer,
      this.dimensionCalculator,
      this.domManager,
      this.historyManager 
    );
    
    this.editingManager = new EditingManager(
      this.container,
      this.options,
      this.stateManager,
      this.domManager,
      this.renderer,
      this.interactionManager
    );
    
    // EventManager needs EditingManager and InteractionManager, and now 'this' (Spreadsheet instance)
    this.eventManager = new EventManager(
      this.container,
      this.editingManager, 
      this.interactionManager, 
      this.stateManager,
      this.dimensionCalculator,
      this.renderer,
      this.options,
      this.domManager,
      this // Pass the Spreadsheet instance
    );
    
    // This was previously in EventManager constructor, but InteractionManager needs EditingManager
    // It's better if InteractionManager is fully set up before EventManager uses it.
    // However, the prompt stated this call was in EventManager.
    // If setEditingManager is crucial for EventManager's construction or early use of InteractionManager,
    // it should be called here. Given the current structure, it's called within EventManager.
    // Let's ensure custom events for InteractionManager are bound after it's fully set up.
     this.interactionManager.bindCustomEvents((event: CustomEvent) => {
      if (event.type === "resize") {
        this.onDataUpdate();
        if (event.detail)
          this.interactionManager.bringBoundsIntoView(event.detail);
      }
    });

    // Final setup steps
    this.stateManager.setInitialData(data);
    this.dimensionCalculator.calculateTotalSize();
    if (this.options.autoResizeRowHeight && data.length) {
      this.dimensionCalculator.autoResizeRowHeights();
      this.dimensionCalculator.calculateTotalSize();
    }
    this.domManager.setup(
      this.stateManager.getTotalContentWidth(),
      this.stateManager.getTotalContentHeight(),
      this.options.headerHeight,
      this.options.rowNumberWidth
    );
    this.dimensionCalculator.calculateDimensions(
      this.container.clientWidth,
      this.container.clientHeight
    );
    this.eventManager.bindEvents(); // bindEvents should be called after all managers are ready
    this.draw();
    log("log", this.options.verbose, "Spreadsheet initialized");
  }

  private _applyAction(action: HistoryAction, isUndo: boolean): void {
    const { type, payload } = action;
    log("log", this.options.verbose, `Applying action (undo: ${isUndo}):`, action);

    this.stateManager.clearAllSelections();
    this.editingManager.deactivateEditor(false);

    switch (type) {
      case 'cell_update':
        if (payload.rowIndex !== undefined && payload.colIndex !== undefined) {
          const valueToApply = isUndo ? payload.oldValue : payload.newValue;
          this.stateManager.updateCellInternal(payload.rowIndex, payload.colIndex, valueToApply);
          this.stateManager.updateDisabledStatesForRow(payload.rowIndex);
        }
        break;
      case 'batch_cell_update':
        if (payload.updates) {
          payload.updates.forEach(update => {
            const valueToApply = isUndo ? update.oldValue : update.newValue;
            this.stateManager.updateCellInternal(update.rowIndex, update.colIndex, valueToApply);
            this.stateManager.updateDisabledStatesForRow(update.rowIndex);
          });
        } else if (payload.oldValue !== undefined && payload.newValue !== undefined) { // For setData
            const dataToApply = isUndo ? payload.oldValue : payload.newValue;
            this.stateManager.setData(dataToApply as DataRow[], false); 
        }
        break;
      case 'column_resize':
        if (payload.colIndex !== undefined && payload.oldSize !== undefined && payload.newSize !== undefined) {
          const sizeToApply = isUndo ? payload.oldSize : payload.newSize;
          this.stateManager.setColumnWidth(payload.colIndex, sizeToApply, false); 
        }
        break;
      case 'row_resize':
        if (payload.rowIndex !== undefined && payload.oldSize !== undefined && payload.newSize !== undefined) {
          const sizeToApply = isUndo ? payload.oldSize : payload.newSize;
          this.stateManager.setRowHeight(payload.rowIndex, sizeToApply, false); 
        }
        break;
      case 'add_row':
        if (isUndo && payload.rowIndex !== undefined) {
          this.stateManager.deleteRows([payload.rowIndex], false); 
        } else if (!isUndo && payload.rowIndex !== undefined && payload.rowData) {
          const { newRowIndex } = this.stateManager.addRow(false); 
          Object.keys(payload.rowData).forEach(colKey => {
              const colIndex = this.stateManager.getColumns().indexOf(colKey);
              if (colIndex !== -1) {
                  this.stateManager.updateCellInternal(newRowIndex, colIndex, (payload.rowData as DataRow)[colKey]);
              }
          });
          log("warn", this.options.verbose, "Redo for add_row is simplified.");
        }
        break;
      case 'delete_row':
        if (isUndo && payload.deletedRows) {
          const rowsToInsert = [...payload.deletedRows].sort((a:any, b:any) => a.rowIndex - b.rowIndex);
          rowsToInsert.forEach((deletedRowDetail:any) => {
            const {newRowIndex} = this.stateManager.addRow(false); 
            Object.keys(deletedRowDetail.rowData).forEach(colKey => {
                const colIndex = this.stateManager.getColumns().indexOf(colKey);
                if (colIndex !== -1) {
                    this.stateManager.updateCellInternal(newRowIndex, colIndex, deletedRowDetail.rowData[colKey]);
                }
            });
             log("warn", this.options.verbose, `Undo for delete_row (re-adding row at index ${deletedRowDetail.rowIndex}) is simplified and may not restore original order perfectly.`);
          });
        } else if (!isUndo && payload.deletedRows) {
            const indicesToDelete = payload.deletedRows.map((r:any) => r.rowIndex);
            this.stateManager.deleteRows(indicesToDelete, false); 
        }
        break;
      case 'add_column':
        if (isUndo && payload.colIndex !== undefined) {
          this.stateManager.removeColumn(payload.colIndex, false); 
        } else if (!isUndo && payload.colIndex !== undefined && payload.columnSchema) {
          const { colIndex, columnSchema } = payload;
          let colKey = `column_${colIndex}`; 
          if(typeof (columnSchema as ColumnSchema).label === 'string' && (columnSchema as ColumnSchema).label.trim() !== ''){
             colKey = (columnSchema as ColumnSchema).label.toLowerCase().replace(/\s+/g, '_');
          }
          let tempKey = colKey;
          let counter = 1;
          while(this.stateManager.getSchema()[tempKey] !== undefined){
            tempKey = `${colKey}_${counter++}`;
          }
          colKey = tempKey;
          this.stateManager.addColumn(colKey, columnSchema as ColumnSchema, false); 
          log("warn", this.options.verbose, "Redo for add_column is simplified (data not restored).");
        }
        break;
      case 'delete_column':
        if (isUndo && payload.colIndex !== undefined && payload.columnSchema && payload.columnData) {
          const { colIndex, columnSchema, columnData } = payload;
           let colKey = `column_${colIndex}`; 
           if(typeof (columnSchema as ColumnSchema).label === 'string' && (columnSchema as ColumnSchema).label.trim() !== ''){
              colKey = (columnSchema as ColumnSchema).label.toLowerCase().replace(/\s+/g, '_');
           }
           let tempKey = colKey;
           let counter = 1;
           while(this.stateManager.getSchema()[tempKey] !== undefined){
             tempKey = `${colKey}_${counter++}`;
           }
           colKey = tempKey;
          const { newColIndex } = this.stateManager.addColumn(colKey, columnSchema as ColumnSchema, false); 
          if (columnData) {
            (columnData as any[]).forEach((cellValue, rowIndex) => {
              this.stateManager.updateCellInternal(rowIndex, newColIndex, cellValue);
            });
          }
          if(payload.oldSchemaState && (payload.oldSchemaState as any).columnWidths){
            const oldWidth = ((payload.oldSchemaState as any).columnWidths as Map<number,number>).get(colIndex); 
            if(oldWidth !== undefined) this.stateManager.setColumnWidth(newColIndex, oldWidth, false);
          }
          log("warn", this.options.verbose, "Undo for delete_column (re-adding column) is partially implemented.");
        } else if (!isUndo && payload.colIndex !== undefined) {
          this.stateManager.removeColumn(payload.colIndex, false); 
        }
        break;
      default:
        log("warn", this.options.verbose, "Unknown action type for undo/redo:", type);
        return;
    }
    this.onDataUpdate();
  }

  public undo(): void {
    const action = this.historyManager.undo();
    if (action) {
      this._applyAction(action, true);
    }
  }

  public redo(): void {
    const action = this.historyManager.redo();
    if (action) {
      this._applyAction(action, false);
    }
  }
  
  public draw(): void {
    this.stateManager.updateScroll(
      this.domManager.getVScrollPosition(),
      this.domManager.getHScrollPosition()
    );
    this.dimensionCalculator.calculateVisibleRange(); 
    this.renderer.draw();
  }

  private reCalculate() {
    if (this.options.autoResizeRowHeight) {
      this.dimensionCalculator.autoResizeRowHeights();
      this.dimensionCalculator.calculateTotalSize(); 
      this.dimensionCalculator.calculateVisibleRange();
    } else {
      this.dimensionCalculator.calculateTotalSize();
    }
    this.domManager.updateCanvasSize(
      this.stateManager.getTotalContentWidth(),
      this.stateManager.getTotalContentHeight()
    );
    this.domManager.updateScrollbarPositions(
      this.options.headerHeight,
      this.options.rowNumberWidth
    );
    this.dimensionCalculator.calculateDimensions(
      this.container.clientWidth,
      this.container.clientHeight
    );
  }

  private onDataUpdate(top: number = 0, left: number = 0) {
    this.reCalculate();
    this.interactionManager.moveScroll(left, top, true);
    this.draw();
  }
  public async getData(options?: { raw?: boolean; visibleColumnsOnly?: boolean; nonLoadingOnly?: boolean; keepErrors?: boolean; discardOthers?: boolean; }): Promise<DataRow[]> {
    let chunks: DataRow[][] = []; { const data = this.stateManager.getData(options?.raw ?? false); if (options?.raw) return Promise.resolve(data); chunks = chunkArray(data, 1000); }
    let dataToReturn: DataRow[] = []; const schema = this.stateManager.getSchema(); const columns = new Set(this.stateManager.getColumns());
    const recursivePromise = (chunkIndex: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (chunkIndex >= chunks.length) return resolve(false);
        for (const row of chunks[chunkIndex]) {
          let hasErrors = false; let newRow: DataRow = {};
          for (const col of Object.keys(row)) {
            if (options?.keepErrors && col.startsWith(ERROR_FIELD_PREFIX)) { newRow[col] = row[col]; continue; }
            if ( !options?.keepErrors && (col.startsWith(ERROR_FIELD_PREFIX) || (schema[col]?.required && (row[col] ?? "") === "")) ) { hasErrors = true; break; }
            if ( options?.nonLoadingOnly && col.startsWith(LOADING_FIELD_PREFIX) ) { continue; }
            if ( options?.nonLoadingOnly && row[`${LOADING_FIELD_PREFIX}${col}`] ) { newRow[col] = schema[col]?.defaultValue ?? null; continue; }
            if (options?.visibleColumnsOnly && !columns.has(col)) { continue; }
            if (options?.discardOthers && col.includes(":")) { continue; } else { newRow[col] = row[col]; }
          }
          if (hasErrors) { continue; }
          dataToReturn.push(newRow);
        }
        if (chunkIndex === chunks.length - 1) return resolve(true);
        setTimeout(() => { resolve(recursivePromise(chunkIndex + 1)); }, 0);
      });
    };
    await recursivePromise(0); return dataToReturn;
  }
  public get rowCount(): number { return this.stateManager.dataLength; }
  public setData(newData: DataRow[]): void { this.stateManager.setData(newData); this.onDataUpdate(); } 
  public updateColumnSchema(colKey: string, schema: ColumnSchema): void { this.stateManager.updateColumnSchema(colKey, schema); this.onDataUpdate(); } 
  public addRow(): number { const {newRowIndex} = this.stateManager.addRow(); this.onDataUpdate(this.container.scrollHeight, 0); return newRowIndex; } 
  public addColumn(fieldName: string, colSchema: ColumnSchema): number { const {newColIndex} = this.stateManager.addColumn(fieldName, colSchema); this.onDataUpdate(0, this.container.scrollWidth); return newColIndex; } 
  public set schema(schema: SpreadsheetSchema) { this.stateManager.setSchema(schema); this.onDataUpdate(); }
  public get schema(): SpreadsheetSchema { return this.stateManager.getSchema(); }
  public removeColumnByIndex(colIndex: number): void { const columns = this.stateManager.getColumns(); if (colIndex < 0 || colIndex >= columns.length) { throw new Error(`Column index ${colIndex} is out of bounds`); } this.stateManager.removeColumn(colIndex); this.onDataUpdate(0, this.container.scrollWidth); }
  public removeColumnByKey(colKey: string): void { const colIndex = this.stateManager.getColumns().indexOf(colKey); if (colIndex < 0) { throw new Error(`Column key ${colKey} not found`); } this.removeColumnByIndex(colIndex); }
  public updateCell({ rowIndex, colKey, value, flashError, remove, }: CellUpdateInput): void {
    let redrawNeeded = false; const colIndex = this.stateManager.getColumns().indexOf(colKey);
    if (flashError && colIndex >= 0) { this.renderer.setTemporaryErrors([ { row: rowIndex, col: colIndex, error: flashError }, ]); }
    try {
      if (remove) { 
        this.stateManager.updateCell(rowIndex, colKey, null, true, true); 
      } else { 
        const updated = this.stateManager.updateCell( rowIndex, colKey, value, true, true ); 
        if (!updated) return; 
      }
      redrawNeeded = true;
    } catch (error: unknown) {
      if (error instanceof ValidationError) { this.stateManager.updateCell( rowIndex, `${ERROR_FIELD_PREFIX}${colKey}`, error.message, false, false ); redrawNeeded = true; } 
      else { log("warn", this.options.verbose, error); }
    }
    if (redrawNeeded) { if (this.options.autoResizeRowHeight) { this.reCalculate(); } this.draw(); }
  }
  public updateCells(inputs: CellUpdateInput[]): number[] {
    let redrawNeeded = false; const updatedRows = new Set<number>(); const cellsToFlashError: { row: number; col: number; error?: string }[] = [];
    const columns = this.stateManager.getColumns();
    const batchUpdatesForHistory: { rowIndex: number; colIndex: number; oldValue: any; newValue: any; }[] = [];
    for (const { rowIndex, colKey, value, flashError, remove } of inputs) {
      const colIndex = columns.indexOf(colKey);
      const oldValue = this.stateManager.getCellData(rowIndex, colIndex);
      try {
        if (flashError && colIndex >= 0) { cellsToFlashError.push({ row: rowIndex, col: colIndex, error: flashError, }); }
        let actualNewValue = value;
        if (remove) {
          this.stateManager.updateCell(rowIndex, colKey, null, true, false); 
          actualNewValue = null; 
        } else {
          const updated = this.stateManager.updateCell( rowIndex, colKey, value, true, false ); 
          if (!updated) continue;
        }
        batchUpdatesForHistory.push({rowIndex, colIndex, oldValue, newValue: actualNewValue});
        updatedRows.add(rowIndex); redrawNeeded = true;
      } catch (error: unknown) {
        if (error instanceof ValidationError) { this.stateManager.updateCell( rowIndex, `${ERROR_FIELD_PREFIX}${colKey}`, error.message, false, false ); redrawNeeded = true; } 
        else { log("warn", this.options.verbose, error); }
      }
    }

    if(batchUpdatesForHistory.length > 0){
        this.historyManager.addAction({
            type: 'batch_cell_update',
            payload: { updates: batchUpdatesForHistory }
        });
    }

    if (cellsToFlashError.length) { this.renderer.setTemporaryErrors(cellsToFlashError); }
    if (redrawNeeded) { if (this.options.autoResizeRowHeight) { this.reCalculate(); } this.draw(); }
    return Array.from(updatedRows);
  }
  public getSelectedCell(): { row: number; colKey: string } | null { const cell = this.stateManager.getActiveCell(); if (!cell || cell.row==null || cell.col==null) return null; return { row: cell.row!, colKey: this.stateManager.getColumnKey(cell.col!), }; }
  public getRow(rowIndex: number): DataRow | null { const row = this.stateManager.getRowData(rowIndex); if (!row) return null; return JSON.parse(JSON.stringify(row)); }
  public getColumns(): string[] { return this.stateManager.getColumns().slice(); }
  public getColumnWidths(): Record<string, number> { return this.interactionManager.columnWidthMapByKeys(); }
  public setColumnWidths(widths: Record<string, number>): void { 
    Object.entries(widths).forEach(([key, width]) => { 
        const colIndex = this.stateManager.getColumns().indexOf(key); 
        if (colIndex >= 0) { 
            this.stateManager.setColumnWidth(colIndex, width, true); 
        } 
    }); 
    this.redraw(); 
}
  public focus(): void { this.domManager.focusContainer(false); }
  public setValueFromCustomEditor({ rowIndex, colKey, value, }: CellUpdateInput): void { this.focus(); if (this.editingManager.isEditorActive()) { this.editingManager.deactivateEditor(false, true, true); } const colIndex = this.stateManager.getColumns().indexOf(colKey); if (colIndex >= 0) { this.stateManager.setActiveCell({ row: rowIndex, col: colIndex, }); } this.updateCell({ rowIndex, colKey, value }); }
  public deactivateCustomEditor(focusCell?: VisibleCell): void { this.focus(); this.editingManager.deactivateEditor(false, true, true); if (!focusCell) return; const colIndex = this.stateManager.getColumns().indexOf(focusCell.colKey); if (colIndex < 0) return; this.stateManager.setActiveCell({ row: focusCell.rowIndex, col: colIndex, }); this.draw(); }
}
