import {
  RequiredSpreadsheetOptions,
  CellCoords,
  DataType,
  ColumnSchema,
  CellUpdateEvent,
  CellBounds,
  HistoryAction, 
} from "./types";
import { StateManager } from "./state-manager";
import { Renderer } from "./renderer";
import { DimensionCalculator } from "./dimension-calculator";
import { log, validateInput } from "./utils";
import { DomManager } from "./dom-manager";
import { EditingManager } from "./editing-manager"; 
import { ERROR_FIELD_PREFIX } from "./config";
import { HistoryManager } from "./history-manager"; 

export class InteractionManager {
  private options: RequiredSpreadsheetOptions;
  private stateManager: StateManager;
  private renderer: Renderer;
  private dimensionCalculator: DimensionCalculator;
  private domManager: DomManager;
  private editingManager!: EditingManager; 
  private readonly historyManager: HistoryManager; 
  private lastPasteHandledAt: Date | null = null; 
  private ignoreNextScrollTimeout: number | null = null;
  private _customEventHandler: ((event: CustomEvent) => void) | null = null;

  constructor(
    options: RequiredSpreadsheetOptions,
    stateManager: StateManager,
    renderer: Renderer,
    dimensionCalculator: DimensionCalculator,
    domManager: DomManager,
    historyManager: HistoryManager 
  ) {
    this.options = options;
    this.stateManager = stateManager;
    this.renderer = renderer;
    this.dimensionCalculator = dimensionCalculator;
    this.domManager = domManager;
    this.historyManager = historyManager; 
  }

  private _performFill(): void {
    const dragState = this.stateManager.getDragState();
    if (
      !dragState.isDragging ||
      !dragState.startCell ||
      dragState.endRow === null ||
      dragState.startCell.row === null ||
      dragState.startCell.col === null 
    ) {
      return;
    }

    const { verbose, autoResizeRowHeight } = this.options;
    const startCell = dragState.startCell;
    const endRow = dragState.endRow;
    const startRow = startCell.row;
    const startCol = startCell.col; 

    const sourceValue = this.stateManager.getCellData(startRow, startCol);
    const sourceSchema = this.stateManager.getSchemaForColumn(startCol);
    const sourceColumnKey = this.stateManager.getColumnKey(startCol);
    const sourceType = sourceSchema?.type;
    
    let changedOverall = false;
    const dataLength = this.stateManager.dataLength;
    const isFillingDown = endRow >= startRow;
    const firstFillRow = isFillingDown ? startRow + 1 : endRow;
    const lastFillRow = isFillingDown ? endRow : startRow - 1;

    const batchUpdatesForHistory: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] = [];
    const rowsForNotification: number[] = [];
    const oldDataForNotification: any[] = [];


    for (let r = firstFillRow; r <= lastFillRow; r++) {
      if (r < 0 || r >= dataLength) continue;

      const targetSchema = this.stateManager.getSchemaForColumn(startCol);
      if (this.stateManager.isCellDisabled(r, startCol)) {
        log(verbose, this.options.verbose, `Skipping fill for disabled cell ${r},${startCol}`);
        continue;
      }
      if (targetSchema?.type !== sourceType) {
        log(verbose, this.options.verbose, `Skipping fill for row ${r}: Type mismatch (Source: ${sourceType}, Target: ${targetSchema?.type})`);
        continue;
      }

      const currentValue = this.stateManager.getCellData(r, startCol);
      if (currentValue !== sourceValue) {
        const oldValue = this.stateManager.updateCellInternal(r, startCol, sourceValue);
        batchUpdatesForHistory.push({ rowIndex: r, colIndex: startCol, oldValue, newValue: sourceValue });
        
        rowsForNotification.push(r);
        oldDataForNotification.push({ [sourceColumnKey]: oldValue });
        changedOverall = true;
      }
    }

    if (batchUpdatesForHistory.length > 0) {
      this.historyManager.addAction({
        type: 'batch_cell_update',
        payload: { updates: batchUpdatesForHistory },
      });
    }

    if (changedOverall) { 
      if (autoResizeRowHeight) {
        this.resizeRowsForColumn(); 
      } else {
        this.renderer.draw();
      }
    }

    if (rowsForNotification.length > 0) {
      this._batchUpdateCellsAndNotify(rowsForNotification, [sourceColumnKey], oldDataForNotification);
    }
  }
  
  public _batchUpdateCellsAndNotify(
    rows: number[], 
    updateColumns: string[], 
    oldRowsData?: any[] 
  ): void {
    if (!rows || rows.length === 0) return;

    const updatedRowsForEvent: CellUpdateEvent[] = [];
    rows.forEach((rowIndex, index) => {
      this.stateManager.updateDisabledStatesForRow(rowIndex); 
      
      const currentData = this.stateManager.getRowData(rowIndex);
      if (currentData) { 
          updatedRowsForEvent.push({
            rowIndex,
            columnKeys: updateColumns, 
            data: currentData, 
            oldData: oldRowsData?.[index], 
          });
      }
    });

    if (updatedRowsForEvent.length > 0) {
      this.stateManager.callOnCellsUpdate(updatedRowsForEvent);
    }
  }

  public paste(): boolean {
    if ( this.lastPasteHandledAt && Date.now() - this.lastPasteHandledAt.getTime() < 1000 ) { return false; }
    this.lastPasteHandledAt = new Date();
    const activeCell = this.stateManager.getActiveCell();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();
    const copiedValue = this.stateManager.getCopiedValue();
    const copiedValueType = this.stateManager.getCopiedValueType();
    const copiedRangeData = this.stateManager.getCopiedRangeData();
    const targetRange = selectionRange;
    const targetCell = !targetRange && activeCell ? activeCell : null;
    if (!targetRange && !targetCell) { return false; }

    let changed = false;
    const batchUpdatesForHistory: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] = [];

    if (copiedRangeData) {
      if (targetRange) {
        changed = this._pasteRangeToRange(targetRange, copiedRangeData, batchUpdatesForHistory);
      } else if (targetCell && targetCell.row !== null && targetCell.col !== null) {
        changed = this._pasteRangeFromTopLeft(targetCell, copiedRangeData, batchUpdatesForHistory);
      }
    } else if (copiedValue !== undefined) {
      if (targetRange) {
        changed = this._pasteSingleValueToRange(targetRange, copiedValue, copiedValueType, batchUpdatesForHistory);
      } else if (targetCell && targetCell.row !== null && targetCell.col !== null) {
        changed = this._pasteSingleValue(targetCell, copiedValue, copiedValueType, batchUpdatesForHistory);
      }
    }

    if (batchUpdatesForHistory.length > 0) {
      this.historyManager.addAction({
        type: 'batch_cell_update',
        payload: { updates: batchUpdatesForHistory },
      });
    }
    return changed;
  }

  private _pasteSingleValue( targetCell: CellCoords, value: any, valueType: DataType | undefined, batchUpdatesForHistory?: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] ): boolean {
    if (targetCell.row === null || targetCell.col === null) return false;
    const targetRow = targetCell.row; const targetCol = targetCell.col;
    const targetColKey = this.stateManager.getColumnKey(targetCol);
    const targetSchema = this.stateManager.getSchemaForColumn(targetCol);
    if (this.stateManager.isCellDisabled(targetRow, targetCol)) { return false; }
    if (targetSchema?.type !== valueType && value !== null) {
      const convertedValue = this._convertValueForTargetType( value, targetColKey, targetSchema );
      if (convertedValue === null) { return false; }
      value = convertedValue;
    }
    const currentValue = this.stateManager.getCellData(targetRow, targetCol);
    const validationResult = validateInput( value, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose, this.stateManager.getData(true), targetRow );
    if ("error" in validationResult) {
      if (validationResult.errorType === "required" && !currentValue) { this.stateManager.updateCell( targetRow, `${ERROR_FIELD_PREFIX}${targetColKey}`, validationResult.error ); } 
      else { this.renderer.setTemporaryErrors([ { row: targetRow, col: targetCol, error: validationResult.error }, ]); }
      return true; 
    } else { this.stateManager.removeCellValue( targetRow, `${ERROR_FIELD_PREFIX}${targetColKey}` ); }
    
    if (currentValue !== value) {
      const oldValue = this.stateManager.updateCellInternal(targetRow, targetCol, value);
      batchUpdatesForHistory?.push({ rowIndex: targetRow, colIndex: targetCol, oldValue, newValue: value });
      this._batchUpdateCellsAndNotify([targetRow], [targetColKey], [{[targetColKey]: oldValue}]);
      return true;
    }
    return false;
  }

  private _pasteSingleValueToRange( targetRange: { start: CellCoords; end: CellCoords }, value: any, valueType: DataType | undefined, batchUpdatesForHistory?: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] ): boolean {
    let changed = false;
    const affectedRowsNotify: number[] = []; const affectedColsNotify = new Set<string>(); const oldDataNotify = new Map<number, any>();

    for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
      for (let col = targetRange.start.col!; col <= targetRange.end.col!; col++) {
        const targetColKey = this.stateManager.getColumnKey(col);
        const targetSchema = this.stateManager.getSchemaForColumn(col);
        if (this.stateManager.isCellDisabled(row, col)) continue;
        let valueToUse = value;
        if (targetSchema?.type !== valueType && value !== null) {
          valueToUse = this._convertValueForTargetType(value, targetColKey, targetSchema);
          if (valueToUse === null) continue;
        }
        const currentValue = this.stateManager.getCellData(row, col);
        const validationResult = validateInput( valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose, this.stateManager.getData(true), row );
        if ("error" in validationResult) {
          if (validationResult.errorType === "required" && !currentValue) { this.stateManager.updateCell( row, `${ERROR_FIELD_PREFIX}${targetColKey}`, validationResult.error ); } 
          else { this.renderer.setTemporaryErrors([{ row, col, error: validationResult.error }]); }
          changed = true; continue;
        } else { this.stateManager.removeCellValue( row, `${ERROR_FIELD_PREFIX}${targetColKey}` ); }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(row, col, valueToUse);
          batchUpdatesForHistory?.push({ rowIndex: row, colIndex: col, oldValue, newValue: valueToUse });
          
          if (!affectedRowsNotify.includes(row)) affectedRowsNotify.push(row);
          affectedColsNotify.add(targetColKey);
          const oldRowEntry = oldDataNotify.get(row) || {}; oldRowEntry[targetColKey] = oldValue; oldDataNotify.set(row, oldRowEntry);
          changed = true;
        }
      }
    }
    if (affectedRowsNotify.length > 0) {
        const finalOldData = affectedRowsNotify.map(r => oldDataNotify.get(r));
        this._batchUpdateCellsAndNotify(affectedRowsNotify, Array.from(affectedColsNotify), finalOldData);
    }
    return changed;
  }

  private _pasteRangeFromTopLeft( startCell: CellCoords, rangeData: any[][], batchUpdatesForHistory?: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] ): boolean {
    if ( startCell.row === null || startCell.col === null || !rangeData || rangeData.length === 0 ) { return false; }
    const startRow = startCell.row; const startCol = startCell.col;
    const numRowsToPaste = rangeData.length; const numColsToPaste = rangeData[0]?.length || 0;
    let changed = false;
    const totalRows = this.stateManager.dataLength; const totalCols = this.stateManager.getColumns().length;
    const affectedRowsNotify: number[] = []; const affectedColsNotify = new Set<string>(); const oldDataNotify = new Map<number, any>();

    for (let rOffset = 0; rOffset < numRowsToPaste; rOffset++) {
      const targetRow = startRow + rOffset; if (targetRow >= totalRows) break;
      const pastedRowData = rangeData[rOffset];
      for (let cOffset = 0; cOffset < numColsToPaste; cOffset++) {
        const targetCol = startCol + cOffset; if (targetCol >= totalCols) break;
        const valueToPaste = pastedRowData[cOffset];
        const targetColKey = this.stateManager.getColumnKey(targetCol);
        const targetSchema = this.stateManager.getSchemaForColumn(targetCol);
        if (this.stateManager.isCellDisabled(targetRow, targetCol)) continue;
        let valueToUse = valueToPaste;
        if (valueToUse !== null) {
          valueToUse = this._convertValueForTargetType( valueToPaste, targetColKey, targetSchema );
          if (valueToUse === null) continue; 
        }
        const currentValue = this.stateManager.getCellData(targetRow, targetCol);
        const validationResult = validateInput( valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose, this.stateManager.getData(true), targetRow );
        if ("error" in validationResult) {
          if (validationResult.errorType === "required" && !currentValue) { this.stateManager.updateCell( targetRow, `${ERROR_FIELD_PREFIX}${targetColKey}`, validationResult.error ); } 
          else { this.renderer.setTemporaryErrors([{ row: targetRow, col: targetCol, error: validationResult.error }]); }
          changed = true; continue;
        } else { this.stateManager.removeCellValue( targetRow, `${ERROR_FIELD_PREFIX}${targetColKey}` ); }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(targetRow, targetCol, valueToUse);
          batchUpdatesForHistory?.push({ rowIndex: targetRow, colIndex: targetCol, oldValue, newValue: valueToUse });
          if (!affectedRowsNotify.includes(targetRow)) affectedRowsNotify.push(targetRow);
          affectedColsNotify.add(targetColKey);
          const oldRowEntry = oldDataNotify.get(targetRow) || {}; oldRowEntry[targetColKey] = oldValue; oldDataNotify.set(targetRow, oldRowEntry);
          changed = true;
        }
      }
    }
     if (affectedRowsNotify.length > 0) {
        const finalOldData = affectedRowsNotify.map(r => oldDataNotify.get(r));
        this._batchUpdateCellsAndNotify(affectedRowsNotify, Array.from(affectedColsNotify), finalOldData);
    }
    return changed;
  }

  private _pasteRangeToRange( targetRange: { start: CellCoords; end: CellCoords }, sourceRangeData: any[][], batchUpdatesForHistory?: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] ): boolean {
    if (!sourceRangeData || sourceRangeData.length === 0) return false;
    const sourceRows = sourceRangeData.length; const sourceCols = sourceRangeData[0]?.length || 0;
    if (sourceCols === 0) return false;
    let changed = false;
    const affectedRowsNotify: number[] = []; const affectedColsNotify = new Set<string>(); const oldDataNotify = new Map<number, any>();

    for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
      for (let col = targetRange.start.col!; col <= targetRange.end.col!; col++) {
        const sourceRowIndex = (row - targetRange.start.row!) % sourceRows;
        const sourceColIndex = (col - targetRange.start.col!) % sourceCols;
        const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex];
        const targetColKey = this.stateManager.getColumnKey(col);
        const targetSchema = this.stateManager.getSchemaForColumn(col);
        if (this.stateManager.isCellDisabled(row, col)) continue;
        let valueToUse = valueToPaste;
        if (valueToUse !== null) {
          valueToUse = this._convertValueForTargetType( valueToPaste, targetColKey, targetSchema );
          if (valueToUse === null) continue; 
        }
        const currentValue = this.stateManager.getCellData(row, col);
        const validationResult = validateInput( valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose, this.stateManager.getData(true), row );
        if ("error" in validationResult) {
          if (validationResult.errorType === "required" && !currentValue) { this.stateManager.updateCell( row, `${ERROR_FIELD_PREFIX}${targetColKey}`, validationResult.error ); } 
          else { this.renderer.setTemporaryErrors([{ row, col, error: validationResult.error }]); }
          changed = true; continue;
        } else { this.stateManager.removeCellValue( row, `${ERROR_FIELD_PREFIX}${targetColKey}` ); }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(row, col, valueToUse);
          batchUpdatesForHistory?.push({ rowIndex: row, colIndex: col, oldValue, newValue: valueToUse });
          if (!affectedRowsNotify.includes(row)) affectedRowsNotify.push(row);
          affectedColsNotify.add(targetColKey);
          const oldRowEntry = oldDataNotify.get(row) || {}; oldRowEntry[targetColKey] = oldValue; oldDataNotify.set(row, oldRowEntry);
          changed = true;
        }
      }
    }
    if (affectedRowsNotify.length > 0) {
        const finalOldData = affectedRowsNotify.map(r => oldDataNotify.get(r));
        this._batchUpdateCellsAndNotify(affectedRowsNotify, Array.from(affectedColsNotify), finalOldData);
    }
    return changed;
  }

  public pasteSingleValueExternal( targetCell: CellCoords, value: string ): boolean {
    if (targetCell.row === null || targetCell.col === null) return false;
    const targetSchema = this.stateManager.getSchemaForColumn(targetCell.col);
    if (targetSchema?.type !== "text") { return false; }
    const batchUpdates: any[] = [];
    const changed = this._pasteSingleValue(targetCell, value, "text", batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }

  public pasteRangeFromTopLeftExternal( startCell: CellCoords, rangeData: string[][] ): boolean {
    const batchUpdates: any[] = [];
    const changed = this._pasteRangeFromTopLeft(startCell, rangeData, batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }

  public pasteRangeToRangeExternal( targetRange: { start: CellCoords; end: CellCoords }, sourceRangeData: string[][] ): boolean {
    const batchUpdates: any[] = [];
    const changed = this._pasteRangeToRange(targetRange, sourceRangeData, batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }

  public pasteToColumnExternal(columnIndex: number, value: string): boolean {
    const schemaColumn = this.stateManager.getSchemaForColumn(columnIndex);
    const dataLength = this.stateManager.dataLength;
    let changedAny = false;
    if (value === undefined || value === null) { return false; }
    const colKey = this.stateManager.getColumnKey(columnIndex);
    const convertedValue = this._convertValueForTargetType(value, colKey, schemaColumn);
    
    const batchUpdatesForHistory: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] = [];
    const affectedRowsNotify: number[] = [];
    const oldDataForNotification: any[] = [];


    for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
      if (this.stateManager.isCellDisabled(rowIndex, columnIndex)) continue;
      const currentValue = this.stateManager.getCellData(rowIndex, columnIndex);
      if (currentValue !== convertedValue) {
        const oldValue = this.stateManager.updateCellInternal(rowIndex, columnIndex, convertedValue);
        batchUpdatesForHistory.push({ rowIndex, colIndex: columnIndex, oldValue, newValue: convertedValue });
        affectedRowsNotify.push(rowIndex);
        oldDataForNotification.push({[colKey]: oldValue});
        changedAny = true;
      }
    }
    if (batchUpdatesForHistory.length > 0) {
      this.historyManager.addAction({
        type: 'batch_cell_update',
        payload: { updates: batchUpdatesForHistory },
      });
    }
    if (changedAny) {
      this._batchUpdateCellsAndNotify(affectedRowsNotify, [colKey], oldDataForNotification );
      this.renderer.draw(); 
    }
    return changedAny;
  }
  public bindCustomEvents( customEventHandler: ((event: CustomEvent) => void) | null = null ): void { this._customEventHandler = customEventHandler; }
  public triggerCustomEvent( eventName: "resize", focusBounds?: CellBounds | null ): void { this._customEventHandler?.call( this, new CustomEvent(eventName, { detail: focusBounds }) ); }
  public setEditingManager(editingManager: EditingManager): void { this.editingManager = editingManager; }
  public findAdjacentCellByColumnIndex(colIndex: number): CellBounds | null {
    const { visibleRowEnd, visibleColStart, visibleColEnd } = this.stateManager.getVisibleRange();
    let adjacentColIndex = null;
    if (colIndex > visibleColStart) { adjacentColIndex = colIndex - 1;
    } else if (colIndex < visibleColEnd) { adjacentColIndex = colIndex + 1; }
    if (adjacentColIndex !== null && visibleRowEnd !== null) { return this.renderer.getCellBounds(visibleRowEnd, adjacentColIndex); }
    return null;
  }
  public findAdjacentCellByRowIndex(rowIndex: number): CellBounds | null {
    const { visibleRowStart, visibleRowEnd, visibleColEnd } = this.stateManager.getVisibleRange();
    let adjacentRowIndex = null;
    if (rowIndex > visibleRowStart) { adjacentRowIndex = rowIndex - 1;
    } else if (rowIndex < visibleRowEnd) { adjacentRowIndex = rowIndex + 1; }
    if (adjacentRowIndex !== null && visibleColEnd !== null) { return this.renderer.getCellBounds(adjacentRowIndex, visibleColEnd); }
    return null;
  }
  public canScrollMore(delta: number, vertical: boolean): boolean {
    if (vertical) { return delta > 0 ? this.domManager.canVScrollDown() : this.domManager.canVScrollUp();
    } else { return delta > 0 ? this.domManager.canHScrollRight() : this.domManager.canHScrollLeft(); }
  }
  public moveScroll( deltaX: number, deltaY: number, isAbsolute: boolean = false ): void {
    const scrollTop = this.domManager.setVScrollPosition( isAbsolute ? deltaY : this.domManager.getVScrollPosition() + deltaY );
    const scrollLeft = this.domManager.setHScrollPosition( isAbsolute ? deltaX : this.domManager.getHScrollPosition() + deltaX );
    this.stateManager.updateScroll(scrollTop, scrollLeft);
  }
  public bringBoundsIntoView(bounds: CellBounds): { scrollLeft: number; scrollTop: number; } {
    const scrollLeft = this.domManager.getHScrollPosition();
    const scrollTop = this.domManager.getVScrollPosition();
    const canvasRect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth } = this.options;
    const boundsX = bounds.x - scrollLeft;
    const boundsY = bounds.y - scrollTop;
    const boundsWidth = bounds.width;
    const boundsHeight = bounds.height;
    let newScrollLeft = scrollLeft;
    let newScrollTop = scrollTop;
    if (boundsX < rowNumberWidth) { newScrollLeft += boundsX - rowNumberWidth;
    } else if (boundsX + boundsWidth > canvasRect.width) { newScrollLeft += boundsX + boundsWidth - canvasRect.width; }
    if (boundsY < headerHeight) { newScrollTop += boundsY - headerHeight;
    } else if (boundsY + boundsHeight > canvasRect.height) { newScrollTop += boundsY + boundsHeight - canvasRect.height; }
    newScrollLeft = Math.max(0, newScrollLeft);
    newScrollTop = Math.max(0, newScrollTop);
    if (newScrollLeft !== scrollLeft || newScrollTop !== scrollTop) { this.moveScroll(newScrollLeft, newScrollTop, true); }
    this.ignoreNextScrollTimeout = null; 
    this.onScroll(false);
    this.ignoreNextScrollTimeout = setTimeout(() => { this.ignoreNextScrollTimeout = null; }, 10); 
    return { scrollLeft: newScrollLeft, scrollTop: newScrollTop, };
  }
  public onScroll(hideEditor: boolean = true) {
    if (this.ignoreNextScrollTimeout) { clearTimeout(this.ignoreNextScrollTimeout); this.ignoreNextScrollTimeout = null; return; }
    if (hideEditor) { this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown(); }
    this.dimensionCalculator.calculateVisibleRange();
    this.renderer.draw();
  }
  public handleRowNumberClick( clickedRow: number, isShiftKey: boolean, isCtrlKey: boolean ): boolean {
    const selectedRows = new Set(this.stateManager.getSelectedRows());
    let lastClickedRow = this.stateManager.getLastClickedRow();
    const originalSelectedRowsJson = JSON.stringify( Array.from(selectedRows).sort() );
    const originalLastClickedRow = lastClickedRow;
    if (isShiftKey && lastClickedRow !== null) {
      const start = Math.min(lastClickedRow, clickedRow);
      const end = Math.max(lastClickedRow, clickedRow);
      const newSelectedRows = new Set<number>();
      for (let i = start; i <= end; i++) { newSelectedRows.add(i); }
      if ( JSON.stringify(Array.from(newSelectedRows).sort()) !== originalSelectedRowsJson ) { this.stateManager.setSelectedRows(newSelectedRows, lastClickedRow); }
    } else if (isCtrlKey) {
      if (selectedRows.has(clickedRow)) { selectedRows.delete(clickedRow); } else { selectedRows.add(clickedRow); }
      lastClickedRow = clickedRow; 
      this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
    } else {
      selectedRows.clear();
      selectedRows.add(clickedRow);
      lastClickedRow = clickedRow;
      this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
    }
    const rowsChanged = JSON.stringify(Array.from(this.stateManager.getSelectedRows()).sort()) !== originalSelectedRowsJson;
    const lastClickChanged = this.stateManager.getLastClickedRow() !== originalLastClickedRow;
    const changed = rowsChanged || lastClickChanged;
    if (changed) {
      this.stateManager.setActiveCell(null); 
      this.stateManager.clearSelectionRange(); 
      this.stateManager.setSelectedColumn(null); 
    }
    return changed;
  }
  public handleHeaderClick(clickedCol: number): boolean {
    const selectedColumn = this.stateManager.getSelectedColumn();
    this.stateManager.setSelectedColumn(clickedCol);
    const changed = selectedColumn !== clickedCol;
    if (changed) {
      this.stateManager.setActiveCell(null); 
      this.stateManager.clearSelectionRange(); 
      this.stateManager.setSelectedRows(new Set(), null); 
    }
    return changed;
  }
  public clearSelections(): boolean {
    let changed = false;
    if (this.stateManager.getSelectedRows().size > 0) { changed = this.stateManager.setSelectedRows(new Set(), null) || changed; }
    if (this.stateManager.getSelectedColumn() !== null) { changed = this.stateManager.setSelectedColumn(null) || changed; }
    return changed;
  }
  public checkResizeHandles(event: MouseEvent): "column" | "row" | null {
    const rect = this.domManager.getCanvasBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const { headerHeight, rowNumberWidth, resizeHandleSize, defaultRowHeight, defaultColumnWidth, } = this.options;
    let contentX: number; let contentY: number;
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) {
      contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft();
      const columns = this.stateManager.getColumns();
      const columnWidths = this.stateManager.getColumnWidths();
      let currentX = 0; 
      for (let col = 0; col < columns.length; col++) {
        const colWidth = columnWidths.get(col) || defaultColumnWidth;
        const borderX = currentX + colWidth;
        if (Math.abs(contentX - borderX) <= resizeHandleSize) { this._startColumnResize(col, event.clientX); return "column"; }
        currentX += colWidth;
        if (currentX > contentX + resizeHandleSize) break; 
      }
    }
    if (canvasX < rowNumberWidth && canvasY >= headerHeight) {
      contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
      const dataLength = this.stateManager.dataLength;
      const rowHeights = this.stateManager.getRowHeights();
      let currentY = 0; 
      for (let row = 0; row < dataLength; row++) {
        const rowHeight = rowHeights.get(row) || defaultRowHeight;
        const borderY = currentY + rowHeight;
        if (Math.abs(contentY - borderY) <= resizeHandleSize) { this._startRowResize(row, event.clientY); return "row"; }
        currentY += rowHeight;
        if (currentY > contentY + resizeHandleSize) break; 
      }
    }
    return null;
  }
  private _startColumnResize(colIndex: number, startX: number): void {
    this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown();
    const canvas = this.domManager.getCanvas();
    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvas.width; snapshotCanvas.height = canvas.height;
    const snapshotCtx = snapshotCanvas.getContext("2d");
    if (snapshotCtx) { snapshotCtx.drawImage(canvas, 0, 0); }
    const originalWidth = this.stateManager.getColumnWidth(colIndex);
    this.stateManager.setResizeColumnState({ isResizing: true, columnIndex: colIndex, startX: startX, canvasSnapshot: snapshotCanvas, originalWidth: originalWidth, });
    this.domManager.setCursor("col-resize");
  }
  private _startRowResize(rowIndex: number, startY: number): void {
    this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown();
    const canvas = this.domManager.getCanvas();
    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvas.width; snapshotCanvas.height = canvas.height;
    const snapshotCtx = snapshotCanvas.getContext("2d");
    if (snapshotCtx) { snapshotCtx.drawImage(canvas, 0, 0); }
    const originalHeight = this.stateManager.getRowHeight(rowIndex);
    this.stateManager.setResizeRowState({ isResizing: true, rowIndex: rowIndex, startY: startY, canvasSnapshot: snapshotCanvas, originalHeight: originalHeight, });
    this.domManager.setCursor("row-resize");
  }
   public handleResizeMouseMove(event: MouseEvent): void {
    const { minColumnWidth, maxColumnWidth, minRowHeight, maxRowHeight } = this.options;
    const columnResizeState = this.stateManager.getResizeColumnState();
    const rowResizeState = this.stateManager.getResizeRowState();
    if ( columnResizeState.isResizing && columnResizeState.columnIndex !== null && columnResizeState.startX !== null && columnResizeState.canvasSnapshot ) {
      const deltaX = event.clientX - columnResizeState.startX;
      const colIndex = columnResizeState.columnIndex;
      const originalWidth = columnResizeState.originalWidth || this.stateManager.getColumnWidth(colIndex);
      let newWidth = originalWidth + deltaX;
      newWidth = Math.max(minColumnWidth, Math.min(newWidth, maxColumnWidth));
      this.stateManager.setColumnWidth(colIndex, newWidth); 
      this.renderer.renderResizeDivider( columnResizeState.canvasSnapshot, "column", colIndex, newWidth );
    } else if ( rowResizeState.isResizing && rowResizeState.rowIndex !== null && rowResizeState.startY !== null && rowResizeState.canvasSnapshot ) {
      const deltaY = event.clientY - rowResizeState.startY;
      const rowIndex = rowResizeState.rowIndex;
      const originalHeight = rowResizeState.originalHeight || this.stateManager.getRowHeight(rowIndex);
      let newHeight = originalHeight + deltaY;
      newHeight = Math.max(minRowHeight, Math.min(newHeight, maxRowHeight));
      this.stateManager.setRowHeight(rowIndex, newHeight); 
      this.renderer.renderResizeDivider( rowResizeState.canvasSnapshot, "row", rowIndex, newHeight );
    }
  }
  public resizeRowsForColumn(): void {
    this.dimensionCalculator.autoResizeRowHeights();
    this.dimensionCalculator.calculateTotalSize(); 
    this.dimensionCalculator.calculateVisibleRange(); 
    this.domManager.updateCanvasSize( this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight() );
    this.renderer.draw();
  }
  public columnWidthMapByKeys(): Record<string, number> { return Object.fromEntries( Array.from(this.stateManager.getColumnWidths().entries()).map( ([index, width]) => [this.stateManager.getColumnKey(index), width] ) ); }
  public endResize(): void {
    const columnResizeState = this.stateManager.getResizeColumnState();
    const rowResizeState = this.stateManager.getResizeRowState();
    if (columnResizeState.isResizing) {
      this.dimensionCalculator.calculateTotalSize();
      if ( this.options.autoResizeRowHeight && columnResizeState.columnIndex !== null ) { this.resizeRowsForColumn();
      } else {
        this.dimensionCalculator.calculateVisibleRange();
        this.domManager.updateCanvasSize( this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight() );
        this.renderer.draw();
      }
      this.stateManager.setResizeColumnState({ isResizing: false, columnIndex: null, startX: null, canvasSnapshot: undefined, originalWidth: undefined, });
      try { this.options.onColumnWidthsChange?.(this.columnWidthMapByKeys()); } catch (error) { log( "error", this.options.verbose, "Error calling onColumnWidthsChange", error ); }
    }
    if (rowResizeState.isResizing) {
      this.dimensionCalculator.calculateTotalSize();
      this.dimensionCalculator.calculateVisibleRange();
      this.domManager.updateCanvasSize( this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight() );
      this.renderer.draw();
      this.stateManager.setResizeRowState({ isResizing: false, rowIndex: null, startY: null, canvasSnapshot: undefined, originalHeight: undefined, });
    }
  }
  public updateCursorStyle(event: MouseEvent): void {
    if ( this.stateManager.isResizing() || this.stateManager.isDraggingFillHandle() ) return; 
    const rect = this.domManager.getCanvasBoundingClientRect();
    const canvasX = event.clientX - rect.left; const canvasY = event.clientY - rect.top;
    const { headerHeight, rowNumberWidth, resizeHandleSize, defaultRowHeight, defaultColumnWidth, } = this.options;
    let contentX: number; let contentY: number;
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) { contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); contentY = canvasY;
    } else if (canvasX < rowNumberWidth && canvasY >= headerHeight) { contentX = canvasX; contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    } else if (canvasX >= rowNumberWidth && canvasY >= headerHeight) { contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    } else { contentX = canvasX; contentY = canvasY; }
    const columns = this.stateManager.getColumns(); const dataLength = this.stateManager.dataLength;
    const columnWidths = this.stateManager.getColumnWidths(); const rowHeights = this.stateManager.getRowHeights();
    let newCursor = "default";
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) {
      let currentX = 0; 
      for (let col = 0; col < columns.length; col++) {
        const colWidth = columnWidths.get(col) || defaultColumnWidth;
        const borderX = currentX + colWidth;
        if (Math.abs(contentX - borderX) <= resizeHandleSize) { newCursor = "col-resize"; break; }
        currentX += colWidth; if (currentX > contentX + resizeHandleSize) break; 
      }
    }
    if ( newCursor === "default" && canvasX < rowNumberWidth && canvasY >= headerHeight ) {
      let currentY = 0; 
      for (let row = 0; row < dataLength; row++) {
        const rowHeight = rowHeights.get(row) || defaultRowHeight;
        const borderY = currentY + rowHeight;
        if (Math.abs(contentY - borderY) <= resizeHandleSize) { newCursor = "row-resize"; break; }
        currentY += rowHeight; if (currentY > contentY + resizeHandleSize) break; 
      }
    }
    const activeCell = this.stateManager.getActiveCell();
    if ( newCursor === "default" && activeCell && activeCell.row !== null && activeCell.col !== null && !this.stateManager.getActiveEditor() && canvasX >= rowNumberWidth && canvasY >= headerHeight ) {
      const handleBounds = this.renderer.getFillHandleBounds( activeCell.row, activeCell.col );
      if ( handleBounds && contentX >= handleBounds.x && contentX <= handleBounds.x + handleBounds.width && contentY >= handleBounds.y && contentY <= handleBounds.y + handleBounds.height ) { newCursor = "crosshair"; }
    }
    this.domManager.setCursor(newCursor);
  }
   public checkFillHandle(event: MouseEvent): boolean {
    const activeCell = this.stateManager.getActiveCell();
    if ( !activeCell || this.stateManager.getActiveEditor() || this.stateManager.isResizing() || activeCell.row === null || activeCell.col === null ) { return false; }
    const handleBounds = this.renderer.getFillHandleBounds( activeCell.row, activeCell.col );
    if (!handleBounds) return false;
    const rect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth } = this.options;
    const canvasX = event.clientX - rect.left; const canvasY = event.clientY - rect.top;
    let contentX, contentY;
    if (canvasX >= rowNumberWidth && canvasY >= headerHeight) { contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    } else { return false; }
    if ( contentX >= handleBounds.x && contentX <= handleBounds.x + handleBounds.width && contentY >= handleBounds.y && contentY <= handleBounds.y + handleBounds.height ) { this._startFillHandleDrag(activeCell); return true; }
    return false;
  }
  private _startFillHandleDrag(startCell: CellCoords): void {
    if (startCell.row === null || startCell.col === null) return;
    this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown();
    this.stateManager.setDragState({ isDragging: true, startCell: { ...startCell }, endRow: startCell.row, });
    this.domManager.setCursor("crosshair");
  }
  public handleFillHandleMouseMove(event: MouseEvent): void {
    if (!this.stateManager.isDraggingFillHandle()) return;
    const startCell = this.stateManager.getDragStartCell();
    if (!startCell || startCell.row === null) return;
    const rect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth, defaultRowHeight } = this.options;
    const canvasY = event.clientY - rect.top;
    if (canvasY < headerHeight) { this.stateManager.setDragState({ isDragging: true, startCell: startCell, endRow: 0, }); this.renderer.draw(); return; }
    const contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    const rowHeights = this.stateManager.getRowHeights(); const dataLength = this.stateManager.dataLength;
    let targetRow: number | null = null; let currentY = 0; 
    for (let i = 0; i < dataLength; i++) {
      const rowHeight = rowHeights.get(i) || defaultRowHeight;
      if (contentY >= currentY && contentY < currentY + rowHeight) { targetRow = i; break; }
      currentY += rowHeight; if (currentY > contentY) break; 
    }
    let newEndRow = this.stateManager.getDragEndRow();
    if (targetRow !== null) { newEndRow = targetRow; } else { newEndRow = dataLength - 1; }
    if (newEndRow !== this.stateManager.getDragEndRow()) { this.stateManager.setDragState({ isDragging: true, startCell: startCell, endRow: newEndRow, }); this.renderer.draw(); }
  }
  public endFillHandleDrag(): void {
    if (!this.stateManager.isDraggingFillHandle()) return;
    this._performFill(); 
    this.stateManager.setDragState({ isDragging: false, startCell: null, endRow: null, });
  }
  public copy(): boolean {
    const activeCell = this.stateManager.getActiveCell();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();
    let changed = false;
    if (selectionRange) {
      const { start, end } = selectionRange; const rangeData: any[][] = [];
      let allTypesMatch = true; let firstType: DataType | undefined = undefined;
      for (let r = start.row!; r <= end.row!; r++) {
        const rowData: any[] = [];
        for (let c = start.col!; c <= end.col!; c++) {
          const value = this.stateManager.getCellData(r, c); rowData.push(value);
          const type = this.stateManager.getSchemaForColumn(c)?.type;
          if (r === start.row! && c === start.col!) { firstType = type; } else if (type !== firstType) { allTypesMatch = false; }
        }
        rangeData.push(rowData);
      }
      if (!allTypesMatch) { log( "warn", this.options.verbose, "Copied range contains mixed data types." ); }
      changed = this.stateManager.setCopiedRange(rangeData, selectionRange);
    } else if ( activeCell && activeCell.row !== null && activeCell.col !== null ) {
      const { row, col } = activeCell;
      const value = this.stateManager.getCellData(row, col);
      const type = this.stateManager.getSchemaForColumn(col)?.type;
      changed = this.stateManager.setCopiedValue(value, type, { ...activeCell, });
    }
    return changed;
  }
  private _convertValueForTargetType( value: any, colKey: string, schema?: ColumnSchema ): any {
    const targetType = schema?.type;
    if (value === null || value === undefined || targetType === undefined) { return null; }
    if (Array.isArray(value)) {
      if (schema?.multiple) { return value.map((item) => this._convertValueForTargetType(item, colKey, {...schema, multiple: false, })).filter((item) => item !== null); }
      return value.length > 0 ? this._convertValueForTargetType(value[0], colKey, schema) : null;
    }
    if (targetType === "text" || targetType === "email") { return schema?.autoTrim ? String(value).trim() : String(value); }
    const stringValue = String(value).trim();
    if (stringValue === "") return null;
    switch (targetType) {
      case "number": const num = parseFloat(stringValue); return isNaN(num) ? null : num;
      case "boolean":
        if (typeof value === "boolean") return value;
        const lower = stringValue.toLowerCase();
        if (["true", "yes", "1", "y"].includes(lower)) return true;
        if (["false", "no", "0", "n"].includes(lower)) return false;
        return null;
      case "date":
        if (value instanceof Date) return value.toISOString().split("T")[0];
        try { const date = new Date(value); if (!isNaN(date.getTime())) { return date.toISOString().split("T")[0]; } } catch (e) {}
        return null;
      case "select":
        const cachedOptions = this.stateManager.cachedDropdownOptionsByColumn.get(colKey);
        if (!cachedOptions) return null;
        if (cachedOptions.has(value)) return value;
        if (typeof value !== "string" && cachedOptions.has(stringValue)) return stringValue;
        const option = Array.from(cachedOptions.entries()).find( ([, optName]) => optName.toLowerCase() === stringValue.toLowerCase() );
        if (schema?.multiple && option) { return [option[0]]; }
        return option ? option[0] : null;
      default: return null;
    }
  }
  public clearCopiedCell(): boolean { return this.stateManager.clearCopyState(); }
  public deleteSelectedRows(): boolean {
    const selectedRows = this.stateManager.getSelectedRows();
    if (selectedRows.size === 0) return false;
    const rowsToDelete = Array.from(selectedRows);
    const { deletedCount, deletedData } = this.stateManager.deleteRows(rowsToDelete); 
    try { this.options.onRowDeleted?.(deletedData); } catch (error) { log( "error", this.options.verbose, `Error calling onRowDeleted: ${error}` ); }
    if (deletedCount > 0) {
      this.clearSelections(); this.stateManager.setActiveCell(null); this.clearCopiedCell();
      this.triggerCustomEvent("resize"); return true; 
    }
    return false;
  }
  public startSelectionDrag(startCoords: CellCoords): boolean {
    if (startCoords.row === null || startCoords.col === null) return false;
    let primaryChanged = false; this.stateManager.setDraggingSelection(true);
    const activeChanged = this.stateManager.setActiveCell(startCoords);
    const rangeChanged = this.stateManager.setSelectionRange( startCoords, startCoords );
    primaryChanged = activeChanged || rangeChanged;
    let rowsCleared = false;
    if (primaryChanged) { rowsCleared = this.clearSelections(); }
    if (primaryChanged || rowsCleared) { return true; }
    return false;
  }
  public updateSelectionDrag(endCoords: CellCoords): boolean {
    if ( !this.stateManager.getIsDraggingSelection() || !this.stateManager.getSelectionStartCell() ) { return false; }
    if (endCoords.row === null || endCoords.col === null) return false;
    const currentEnd = this.stateManager.getSelectionEndCell();
    if ( currentEnd?.row !== endCoords.row || currentEnd?.col !== endCoords.col ) { return this.stateManager.setSelectionRange( this.stateManager.getSelectionStartCell(), endCoords ); }
    return false;
  }
  public endSelectionDrag(): void { if (this.stateManager.getIsDraggingSelection()) { this.stateManager.setDraggingSelection(false); } }
  public moveActiveCell( rowDelta: number, colDelta: number, activateEditor = true ): boolean {
    const { verbose, autoAddNewRow } = this.options;
    if (!this.editingManager) { return false; }
    const shouldAddRow = autoAddNewRow && activateEditor;
    const currentActiveCell = this.stateManager.getActiveCell();
    if ( !currentActiveCell || currentActiveCell.row === null || currentActiveCell.col === null ) return false;
    let currentRow = currentActiveCell.row; let currentCol = currentActiveCell.col;
    let numRows = this.stateManager.dataLength; const numCols = this.stateManager.getColumns().length;
    let nextRow = currentRow + rowDelta; let nextCol = currentCol + colDelta;
    if (nextCol >= numCols) { nextCol = 0; nextRow++; } else if (nextCol < 0) { nextCol = numCols - 1; nextRow--; }
    if (nextRow < 0 || (nextRow >= numRows && !shouldAddRow)) {
      this.editingManager.deactivateEditor(true); this.stateManager.setActiveCell(null); return true;
    }
    if (nextRow === numRows && shouldAddRow) {
      const { newRowIndex } = this.stateManager.addRow(); 
      nextRow = newRowIndex;
      this.triggerCustomEvent("resize"); numRows++;
    }
    let safetyCounter = nextRow * numCols + nextCol; 
    const maxSearch = numRows * numCols; 
    while ( this.stateManager.isCellDisabled(nextRow, nextCol) && safetyCounter < maxSearch ) {
      safetyCounter++; nextRow += rowDelta; nextCol += colDelta;
      if (nextCol >= numCols) { nextCol = 0; nextRow++; } else if (nextCol < 0) { nextCol = numCols - 1; nextRow--; }
      if (nextRow < 0 || nextRow >= numRows) { this.editingManager.deactivateEditor(true); this.stateManager.setActiveCell(null); return true; }
    }
    if (safetyCounter >= maxSearch) { this.editingManager.deactivateEditor(true); this.stateManager.setActiveCell(null); return true; }
    this.stateManager.setActiveCell({ row: nextRow, col: nextCol });
    if (activateEditor) { this.editingManager.activateEditor(nextRow, nextCol);
    } else { const bounds = this.renderer.getCellBounds(nextRow, nextCol); if (bounds) { this.bringBoundsIntoView(bounds); } }
    return true;
  }
  public pasteSingleValueExternal( targetCell: CellCoords, value: string ): boolean {
    if (targetCell.row === null || targetCell.col === null) return false;
    const targetSchema = this.stateManager.getSchemaForColumn(targetCell.col);
    if (targetSchema?.type !== "text") { return false; }
    const batchUpdates: any[] = [];
    const changed = this._pasteSingleValue(targetCell, value, "text", batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }
  public pasteRangeFromTopLeftExternal( startCell: CellCoords, rangeData: string[][] ): boolean {
    const batchUpdates: any[] = [];
    const changed = this._pasteRangeFromTopLeft(startCell, rangeData, batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }
  public pasteRangeToRangeExternal( targetRange: { start: CellCoords; end: CellCoords }, sourceRangeData: string[][] ): boolean {
    const batchUpdates: any[] = [];
    const changed = this._pasteRangeToRange(targetRange, sourceRangeData, batchUpdates);
    if(batchUpdates.length > 0){
        this.historyManager.addAction({type: 'batch_cell_update', payload: {updates: batchUpdates}});
    }
    return changed;
  }
  public pasteToColumnExternal(columnIndex: number, value: string): boolean {
    const schemaColumn = this.stateManager.getSchemaForColumn(columnIndex);
    const dataLength = this.stateManager.dataLength;
    let changedAny = false;
    if (value === undefined || value === null) { return false; }
    const colKey = this.stateManager.getColumnKey(columnIndex);
    const convertedValue = this._convertValueForTargetType(value, colKey, schemaColumn);
    
    const batchUpdatesForHistory: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[] = [];
    const affectedRowsNotify: number[] = [];
    const oldDataForNotification: any[] = [];


    for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
      if (this.stateManager.isCellDisabled(rowIndex, columnIndex)) continue;
      const currentValue = this.stateManager.getCellData(rowIndex, columnIndex);
      if (currentValue !== convertedValue) {
        const oldValue = this.stateManager.updateCellInternal(rowIndex, columnIndex, convertedValue);
        batchUpdatesForHistory.push({ rowIndex, colIndex: columnIndex, oldValue, newValue: convertedValue });
        affectedRowsNotify.push(rowIndex);
        oldDataForNotification.push({[colKey]: oldValue});
        changedAny = true;
      }
    }
    if (batchUpdatesForHistory.length > 0) {
      this.historyManager.addAction({
        type: 'batch_cell_update',
        payload: { updates: batchUpdatesForHistory },
      });
    }
    if (changedAny) {
      this._batchUpdateCellsAndNotify(affectedRowsNotify, [colKey], oldDataForNotification );
      this.renderer.draw(); 
    }
    return changedAny;
  }
}
