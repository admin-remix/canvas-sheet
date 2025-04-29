import { StateManager } from './state-manager';
import { CellUpdateEvent, DataRow, ColumnSchema } from './types';
import { log } from './utils';

export enum HistoryActionType {
  CELL_UPDATE = 'cell_update',
  ADD_ROW = 'add_row',
  DELETE_ROW = 'delete_row',
  ADD_COLUMN = 'add_column',
  DELETE_COLUMN = 'delete_column'
}

export interface HistoryEntry {
  type: HistoryActionType;
  affectedRows?: number[];
  oldData?: DataRow[];
  newData?: DataRow[];
  columnKeys?: string[];
  // For row operations
  deletedRows?: DataRow[];
  deletedRowIndices?: number[];
  addedRowIndex?: number;
  // For column operations
  deletedColumnKey?: string;
  deletedColumnIndex?: number;
  deletedColumnSchema?: ColumnSchema;
  addedColumnKey?: string;
  addedColumnSchema?: ColumnSchema;
}

export interface HistoryOperationResult {
  success: boolean;
  needsResize?: boolean;
}

export class HistoryManager {
  private stateManager: StateManager;
  private verbose: boolean;
  private history: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number = 10;
  private isUndoRedoOperation: boolean = false;
  private batchUpdateInProgress: boolean = false;

  constructor(stateManager: StateManager, verbose: boolean = false) {
    this.stateManager = stateManager;
    this.verbose = verbose;
  }

  /**
   * Start tracking changes for a batch update
   */
  public startBatchUpdate(): void {
    this.batchUpdateInProgress = true;
  }

  /**
   * Records cell changes to the history stack
   */
  public recordChanges(changes: CellUpdateEvent[]): void {
    if (this.isUndoRedoOperation || this.batchUpdateInProgress) {
      // Don't record changes during undo/redo operations or batch updates
      return;
    }

    if (changes.length === 0) return;

    // Create a history entry
    const historyEntry: HistoryEntry = {
      type: HistoryActionType.CELL_UPDATE,
      affectedRows: changes.map(change => change.rowIndex),
      oldData: changes.map(change => change.oldData || {}),
      newData: changes.map(change => ({ ...change.data })),
      columnKeys: changes[0].columnKeys // Assuming all changes use the same columns
    };

    this._addHistoryEntry(historyEntry);
  }

  /**
   * Records row addition to history
   */
  public recordRowAdd(rowIndex: number): void {
    if (this.isUndoRedoOperation || this.batchUpdateInProgress) {
      return;
    }

    const historyEntry: HistoryEntry = {
      type: HistoryActionType.ADD_ROW,
      addedRowIndex: rowIndex
    };

    this._addHistoryEntry(historyEntry);
  }

  /**
   * Records row deletion to history
   */
  public recordRowDelete(rowIndices: number[], deletedRows: DataRow[]): void {
    if (this.isUndoRedoOperation || this.batchUpdateInProgress) {
      return;
    }

    const historyEntry: HistoryEntry = {
      type: HistoryActionType.DELETE_ROW,
      deletedRowIndices: rowIndices,
      deletedRows: deletedRows
    };

    this._addHistoryEntry(historyEntry);
  }

  /**
   * Records column addition to history
   */
  public recordColumnAdd(columnKey: string, columnSchema: ColumnSchema): void {
    if (this.isUndoRedoOperation || this.batchUpdateInProgress) {
      return;
    }

    const historyEntry: HistoryEntry = {
      type: HistoryActionType.ADD_COLUMN,
      addedColumnKey: columnKey,
      addedColumnSchema: columnSchema
    };

    this._addHistoryEntry(historyEntry);
  }

  /**
   * Records column deletion to history
   */
  public recordColumnDelete(columnKey: string, columnIndex: number, columnSchema: ColumnSchema): void {
    if (this.isUndoRedoOperation || this.batchUpdateInProgress) {
      return;
    }

    const historyEntry: HistoryEntry = {
      type: HistoryActionType.DELETE_COLUMN,
      deletedColumnKey: columnKey,
      deletedColumnIndex: columnIndex,
      deletedColumnSchema: columnSchema
    };

    this._addHistoryEntry(historyEntry);
  }

  /**
   * Adds a history entry to the stack
   */
  private _addHistoryEntry(entry: HistoryEntry): void {
    // Add to history and clear redo stack
    this.history.push(entry);
    this.redoStack = [];

    // Trim history if exceeds max size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    log('log', this.verbose, `Recorded history entry of type ${entry.type}. History size: ${this.history.length}`);
  }

  /**
   * Undo the last change
   * @returns true if undo was successful, false otherwise
   */
  public undo(): HistoryOperationResult {
    if (this.history.length === 0) {
      log('log', this.verbose, 'No history to undo');
      return { success: false };
    }

    const entry = this.history.pop();
    if (!entry) return { success: false };

    this.redoStack.push(entry);

    // Apply the undo operation based on entry type
    this.isUndoRedoOperation = true;
    const result = this._applyHistoryEntry(entry, true);
    this.isUndoRedoOperation = false;

    log('log', this.verbose, `Undo operation completed for type ${entry.type}`);
    return result;
  }

  /**
   * Redo the last undone change
   * @returns true if redo was successful, false otherwise
   */
  public redo(): HistoryOperationResult {
    if (this.redoStack.length === 0) {
      log('log', this.verbose, 'No changes to redo');
      return { success: false };
    }

    const entry = this.redoStack.pop();
    if (!entry) return { success: false };

    this.history.push(entry);

    // Apply the redo operation based on entry type
    this.isUndoRedoOperation = true;
    const result = this._applyHistoryEntry(entry, false);
    this.isUndoRedoOperation = false;

    log('log', this.verbose, `Redo operation completed for type ${entry.type}`);
    return result;
  }

  /**
   * Applies a history entry (undo or redo)
   * @param entry The history entry to apply
   * @param isUndo If true, applies the undo operation, otherwise redo
   * @returns true if operation was successful
   */
  private _applyHistoryEntry(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    switch (entry.type) {
      case HistoryActionType.CELL_UPDATE:
        return this._applyCellUpdate(entry, isUndo);
      case HistoryActionType.ADD_ROW:
        return this._applyRowAdd(entry, isUndo);
      case HistoryActionType.DELETE_ROW:
        return this._applyRowDelete(entry, isUndo);
      case HistoryActionType.ADD_COLUMN:
        return this._applyColumnAdd(entry, isUndo);
      case HistoryActionType.DELETE_COLUMN:
        return this._applyColumnDelete(entry, isUndo);
      default:
        return { success: false };
    }
  }

  /**
   * Apply cell update history entry
   */
  private _applyCellUpdate(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    if (!entry.affectedRows || !entry.columnKeys) return { success: false };

    const dataToApply = isUndo ? entry.oldData : entry.newData;
    if (!dataToApply) return { success: false };

    const updatedRows: CellUpdateEvent[] = [];

    entry.affectedRows.forEach((rowIndex, index) => {
      const data = dataToApply[index];
      const rowData = this.stateManager.getRowData(rowIndex);
      if (!rowData) return;

      // Apply changes
      entry.columnKeys!.forEach(colKey => {
        if (colKey in data) {
          this.stateManager.updateCellInternal(
            rowIndex,
            this.stateManager.getColumns().indexOf(colKey),
            data[colKey]
          );
        }
      });

      // Update disabled states
      this.stateManager.updateDisabledStatesForRow(rowIndex);

      // Create update event (for notification)
      updatedRows.push({
        rowIndex,
        columnKeys: entry.columnKeys!,
        data: this.stateManager.getRowData(rowIndex)!
      });
    });

    // Notify about the changes (this will trigger a redraw)
    if (updatedRows.length > 0) {
      this.stateManager.callOnCellsUpdate(updatedRows);
    }

    return { success: true };
  }

  /**
   * Apply row add history entry
   */
  private _applyRowAdd(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    if (entry.addedRowIndex === undefined) return { success: false };

    if (isUndo) {
      // Undo row add by deleting the row
      this.stateManager.deleteRows([entry.addedRowIndex]);
      // No need to notify as the state has changed internally
      return { success: true, needsResize: true };
    } else {
      // Redo row add by adding a new row
      this.stateManager.addRow();
      return { success: true, needsResize: true };
    }
  }

  /**
   * Apply row delete history entry
   */
  private _applyRowDelete(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    if (!entry.deletedRowIndices || !entry.deletedRows) return { success: false };

    if (isUndo) {
      // Undo row delete by adding the rows back
      // First, sort indices in ascending order to restore from bottom to top
      const sortedIndices = [...entry.deletedRowIndices].sort((a, b) => a - b);

      // Add the deleted rows back at their original indices
      for (let i = 0; i < sortedIndices.length; i++) {
        // Add a row at the specific index
        this.stateManager.addRowAt(sortedIndices[i], entry.deletedRows[i]);
      }

      return { success: true, needsResize: true };
    } else {
      // Redo row delete
      this.stateManager.deleteRows(entry.deletedRowIndices);
      return { success: true, needsResize: true };
    }
  }

  /**
   * Apply column add history entry
   */
  private _applyColumnAdd(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    if (!entry.addedColumnKey || !entry.addedColumnSchema) return { success: false };

    if (isUndo) {
      // Undo column add by deleting the column
      const colIndex = this.stateManager.getColumns().indexOf(entry.addedColumnKey);
      if (colIndex >= 0) {
        this.stateManager.removeColumn(colIndex);
        return { success: true, needsResize: true };
      }
      return { success: false };
    } else {
      // Redo column add
      this.stateManager.addColumn(entry.addedColumnKey, entry.addedColumnSchema);
      return { success: true, needsResize: true };
    }
  }

  /**
   * Apply column delete history entry
   */
  private _applyColumnDelete(entry: HistoryEntry, isUndo: boolean): HistoryOperationResult {
    if (!entry.deletedColumnKey || !entry.deletedColumnSchema || entry.deletedColumnIndex === undefined) return { success: false };

    if (isUndo) {
      // Undo column delete by adding the column back
      this.stateManager.addColumnAt(entry.deletedColumnIndex, entry.deletedColumnKey, entry.deletedColumnSchema);
      return { success: true, needsResize: true };
    } else {
      // Redo column delete
      const colIndex = this.stateManager.getColumns().indexOf(entry.deletedColumnKey);
      if (colIndex >= 0) {
        this.stateManager.removeColumn(colIndex);
        return { success: true, needsResize: true };
      }
      return { success: false };
    }
  }

  /**
   * Checks if the change is from a parent app update
   * (after onCellsUpdate callback)
   */
  public isParentAppUpdate(): boolean {
    return this.batchUpdateInProgress;
  }

  /**
   * Ends batch update
   */
  public endBatchUpdate(): void {
    this.batchUpdateInProgress = false;
  }

  /**
   * Clear all history
   */
  public clearHistory(): void {
    this.history = [];
    this.redoStack = [];
  }

  /**
   * Check if undo is available
   */
  public canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Check if redo is available
   */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }
} 