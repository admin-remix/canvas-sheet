import { StateManager } from './state-manager';
import { CellUpdateEvent, DataRow } from './types';
import { log } from './utils';

export interface HistoryEntry {
  affectedRows: number[];
  oldData: DataRow[];
  newData: DataRow[];
  columnKeys: string[];
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
   * Records changes to the history stack
   */
  public recordChanges(changes: CellUpdateEvent[]): void {
    if (this.isUndoRedoOperation) {
      // Don't record changes during undo/redo operations
      return;
    }

    if (changes.length === 0) return;

    // Create a history entry
    const historyEntry: HistoryEntry = {
      affectedRows: changes.map(change => change.rowIndex),
      oldData: changes.map(change => change.oldData || {}),
      newData: changes.map(change => ({ ...change.data })),
      columnKeys: changes[0].columnKeys // Assuming all changes use the same columns
    };

    // Add to history and clear redo stack
    this.history.push(historyEntry);
    this.redoStack = [];

    // Trim history if exceeds max size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    log('log', this.verbose, `Recorded history entry. History size: ${this.history.length}`);
  }

  /**
   * Undo the last change
   * @returns true if undo was successful, false otherwise
   */
  public undo(): boolean {
    if (this.history.length === 0) {
      log('log', this.verbose, 'No history to undo');
      return false;
    }

    const entry = this.history.pop();
    if (!entry) return false;

    this.redoStack.push(entry);

    // Apply the old data
    this.isUndoRedoOperation = true;
    this._applyHistoryEntry(entry, true);
    this.isUndoRedoOperation = false;

    log('log', this.verbose, 'Undo operation completed');
    return true;
  }

  /**
   * Redo the last undone change
   * @returns true if redo was successful, false otherwise
   */
  public redo(): boolean {
    if (this.redoStack.length === 0) {
      log('log', this.verbose, 'No changes to redo');
      return false;
    }

    const entry = this.redoStack.pop();
    if (!entry) return false;

    this.history.push(entry);

    // Apply the new data
    this.isUndoRedoOperation = true;
    this._applyHistoryEntry(entry, false);
    this.isUndoRedoOperation = false;

    log('log', this.verbose, 'Redo operation completed');
    return true;
  }

  /**
   * Applies a history entry (undo or redo)
   * @param entry The history entry to apply
   * @param isUndo If true, applies the old data (undo), otherwise applies the new data (redo)
   */
  private _applyHistoryEntry(entry: HistoryEntry, isUndo: boolean): void {
    const dataToApply = isUndo ? entry.oldData : entry.newData;
    const updatedRows: CellUpdateEvent[] = [];

    entry.affectedRows.forEach((rowIndex, index) => {
      const data = dataToApply[index];
      const rowData = this.stateManager.getRowData(rowIndex);
      if (!rowData) return;

      // Apply changes
      entry.columnKeys.forEach(colKey => {
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
        columnKeys: entry.columnKeys,
        data: this.stateManager.getRowData(rowIndex)!,
        // No need to include oldData here
      });
    });

    // Notify about the changes (this will trigger a redraw)
    if (updatedRows.length > 0) {
      this.stateManager.callOnCellsUpdate(updatedRows);
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