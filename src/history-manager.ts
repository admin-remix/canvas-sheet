import { DataRow, ColumnSchema } from './types'; // Assuming these types exist

export type ActionType =
  | 'cell_update'
  | 'batch_cell_update' // For multi-cell operations like paste or fill
  | 'column_resize'
  | 'row_resize'
  | 'add_row'
  | 'delete_row'
  | 'add_column'
  | 'delete_column';

export interface ActionPayload {
  // Cell updates
  rowIndex?: number;
  colIndex?: number;
  oldValue?: any;
  newValue?: any;
  // Batch cell updates
  updates?: { rowIndex: number; colIndex: number; oldValue: any; newValue: any }[];
  // Resize
  oldSize?: number;
  newSize?: number;
  // Add/Delete Row
  rowData?: DataRow;
  // Add/Delete Column
  columnSchema?: ColumnSchema;
  columnData?: any[]; // For storing data of a deleted column
}

export interface HistoryAction {
  type: ActionType;
  payload: ActionPayload;
  // Optional: To store the inverse action for easier redo/undo state management
  inverseAction?: HistoryAction;
}

export class HistoryManager {
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];
  private readonly stackLimit: number;

  constructor(stackLimit: number = 50) { // Default limit of 50 actions
    this.stackLimit = stackLimit;
  }

  public addAction(action: HistoryAction): void {
    this.undoStack.push(action);
    // Clear redo stack whenever a new action is performed
    this.redoStack = [];

    // Enforce stack limit
    if (this.undoStack.length > this.stackLimit) {
      this.undoStack.shift(); // Remove the oldest action
    }
    console.log('Action added:', action, 'Undo stack size:', this.undoStack.length);
  }

  public undo(): HistoryAction | null {
    if (this.undoStack.length === 0) {
      return null;
    }
    const actionToUndo = this.undoStack.pop()!;
    this.redoStack.push(actionToUndo); // Or its inverse if defined
    console.log('Undoing action:', actionToUndo, 'Redo stack size:', this.redoStack.length);
    return actionToUndo;
  }

  public redo(): HistoryAction | null {
    if (this.redoStack.length === 0) {
      return null;
    }
    const actionToRedo = this.redoStack.pop()!;
    this.undoStack.push(actionToRedo); // Or its inverse if defined
    console.log('Redoing action:', actionToRedo, 'Undo stack size:', this.undoStack.length);
    return actionToRedo;
  }

  public clearStacks(): void {
    this.undoStack = [];
    this.redoStack = [];
    console.log('History stacks cleared.');
  }

  public hasUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public hasRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
