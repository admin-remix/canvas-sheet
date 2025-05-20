import {
  SpreadsheetSchema,
  DataRow,
  SpreadsheetOptions,
  ColumnSchema,
  ValidationError,
  CellUpdateInput,
  VisibleCell,
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
import { chunkArray, log } from "./utils";
export type * from "./types";

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

    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Instantiate managers
    this.stateManager = new StateManager(schema, this.options);
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
      this.domManager
    );
    this.interactionManager.bindCustomEvents((event: CustomEvent) => {
      if (event.type === "resize") {
        this.onDataUpdate();
        // bring any target bounds into view, which will trigger a scroll
        if (event.detail)
          this.interactionManager.bringBoundsIntoView(event.detail);
      }
    });
    this.editingManager = new EditingManager(
      this.container,
      this.options,
      this.stateManager,
      this.domManager,
      this.renderer,
      this.interactionManager
    );
    this.eventManager = new EventManager(
      this.container,
      this.editingManager,
      this.interactionManager,
      this.stateManager,
      this.dimensionCalculator,
      this.renderer,
      this.options,
      this.domManager
    );

    this.stateManager.setInitialData(data);
    this.dimensionCalculator.calculateTotalSize();

    // Auto-resize row heights if enabled (during initialization)
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
    this.eventManager.bindEvents();
    this.draw();

    log("log", this.options.verbose, "Spreadsheet initialized");
  }

  public draw(): void {
    this.stateManager.updateScroll(
      this.domManager.getVScrollPosition(),
      this.domManager.getHScrollPosition()
    );
    this.dimensionCalculator.calculateVisibleRange(); // Recalculate visible range based on scroll
    this.renderer.draw();
  }

  private reCalculate() {
    // Auto-resize row heights if enabled
    if (this.options.autoResizeRowHeight) {
      this.dimensionCalculator.autoResizeRowHeights();
      this.dimensionCalculator.calculateTotalSize(); // Recalculate totals
      this.dimensionCalculator.calculateVisibleRange();
    } else {
      this.dimensionCalculator.calculateTotalSize();
    }

    this.domManager.updateCanvasSize(
      this.stateManager.getTotalContentWidth(),
      this.stateManager.getTotalContentHeight()
    );
    // Update scrollbar positions for fixed headers and row numbers
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
    // Need to re-initialize sizes, recalculate dimensions, and redraw
    this.reCalculate();
    this.interactionManager.moveScroll(left, top, true);
    this.draw();
  }

  // --- Public API Methods (delegated to managers) ---

  public async getData(options?: {
    raw?: boolean;
    visibleColumnsOnly?: boolean;
    nonLoadingOnly?: boolean;
    keepErrors?: boolean;
    discardOthers?: boolean;
  }): Promise<DataRow[]> {
    let chunks: DataRow[][] = [];
    {
      const data = this.stateManager.getData(options?.raw ?? false);
      if (options?.raw) return Promise.resolve(data);
      // split the array into chunks of 1000
      chunks = chunkArray(data, 1000);
    }
    let dataToReturn: DataRow[] = [];
    const schema = this.stateManager.getSchema();
    const columns = new Set(this.stateManager.getColumns());
    const recursivePromise = (chunkIndex: number) => {
      return new Promise((resolve) => {
        if (chunkIndex >= chunks.length) return resolve(false);
        for (const row of chunks[chunkIndex]) {
          let hasErrors = false;
          let newRow: DataRow = {};
          for (const col of Object.keys(row)) {
            if (options?.keepErrors && col.startsWith(ERROR_FIELD_PREFIX)) {
              newRow[col] = row[col];
              continue;
            }
            if (
              !options?.keepErrors &&
              (col.startsWith(ERROR_FIELD_PREFIX) ||
                (schema[col]?.required && (row[col] ?? "") === ""))
            ) {
              hasErrors = true;
              break;
            }
            if (
              options?.nonLoadingOnly &&
              col.startsWith(LOADING_FIELD_PREFIX)
            ) {
              continue; // we will handle loading rows later
            }
            if (
              options?.nonLoadingOnly &&
              row[`${LOADING_FIELD_PREFIX}${col}`]
            ) {
              newRow[col] = schema[col]?.defaultValue ?? null;
              continue;
            }
            if (options?.visibleColumnsOnly && !columns.has(col)) {
              continue;
            }
            if (options?.discardOthers && col.includes(":")) {
              continue;
            } else {
              newRow[col] = row[col];
            }
          }
          if (hasErrors) {
            continue;
          }
          dataToReturn.push(newRow);
        }
        if (chunkIndex === chunks.length - 1) return resolve(true);
        setTimeout(() => {
          resolve(recursivePromise(chunkIndex + 1));
        }, 0);
      });
    };
    await recursivePromise(0);
    return dataToReturn;
  }

  public get rowCount(): number {
    return this.stateManager.dataLength;
  }

  public setData(newData: DataRow[]): void {
    this.stateManager.setData(newData);
    this.onDataUpdate();
  }

  public updateColumnSchema(colKey: string, schema: ColumnSchema): void {
    this.stateManager.updateColumnSchema(colKey, schema);
    this.onDataUpdate();
  }

  public addRow(): number {
    const newRowIndex = this.stateManager.addRow();
    this.onDataUpdate(this.container.scrollHeight, 0);
    return newRowIndex;
  }
  public addColumn(fieldName: string, colSchema: ColumnSchema): number {
    const newColIndex = this.stateManager.addColumn(fieldName, colSchema);
    this.onDataUpdate(0, this.container.scrollWidth);
    return newColIndex;
  }
  public set schema(schema: SpreadsheetSchema) {
    this.stateManager.setSchema(schema);
    this.onDataUpdate();
  }
  public get schema(): SpreadsheetSchema {
    return this.stateManager.getSchema();
  }
  public removeColumnByIndex(colIndex: number): void {
    const columns = this.stateManager.getColumns();
    if (colIndex < 0 || colIndex >= columns.length) {
      throw new Error(`Column index ${colIndex} is out of bounds`);
    }
    this.stateManager.removeColumn(colIndex);
    this.onDataUpdate(0, this.container.scrollWidth);
  }
  public removeColumnByKey(colKey: string): void {
    const colIndex = this.stateManager.getColumns().indexOf(colKey);
    if (colIndex < 0) {
      throw new Error(`Column key ${colKey} not found`);
    }
    this.removeColumnByIndex(colIndex);
  }

  public updateCell({
    rowIndex,
    colKey,
    value,
    flashError,
    remove,
  }: CellUpdateInput): void {
    let redrawNeeded = false;
    const colIndex = this.stateManager.getColumns().indexOf(colKey);
    if (flashError && colIndex >= 0) {
      this.renderer.setTemporaryErrors([
        { row: rowIndex, col: colIndex, error: flashError },
      ]);
    }
    try {
      if (remove) {
        this.stateManager.removeCellValue(rowIndex, colKey);
      } else {
        const updated = this.stateManager.updateCell(
          rowIndex,
          colKey,
          value,
          true
        );
        if (!updated) return;
      }
      redrawNeeded = true;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        this.stateManager.updateCell(
          rowIndex,
          `${ERROR_FIELD_PREFIX}${colKey}`,
          error.message
        );
        redrawNeeded = true;
      } else {
        log("warn", this.options.verbose, error);
      }
    }
    if (redrawNeeded) {
      if (this.options.autoResizeRowHeight) {
        this.reCalculate();
      }
      this.draw();
    }
  }
  /**
   * Update multiple cells at once
   * @param inputs - An array of objects with rowIndex, colKey, and updated value properties
   * @returns An array of row indices that were updated
   */
  public updateCells(inputs: CellUpdateInput[]): number[] {
    let redrawNeeded = false;
    const updatedRows = new Set<number>();
    const cellsToFlashError: { row: number; col: number; error?: string }[] =
      [];
    const columns = this.stateManager.getColumns();
    for (const { rowIndex, colKey, value, flashError, remove } of inputs) {
      const colIndex = columns.indexOf(colKey);
      try {
        if (flashError && colIndex >= 0) {
          cellsToFlashError.push({
            row: rowIndex,
            col: colIndex,
            error: flashError,
          });
        }
        if (remove) {
          this.stateManager.removeCellValue(rowIndex, colKey);
        } else {
          const updated = this.stateManager.updateCell(
            rowIndex,
            colKey,
            value,
            true
          );
          if (!updated) continue;
        }
        updatedRows.add(rowIndex);
        redrawNeeded = true;
      } catch (error: unknown) {
        if (error instanceof ValidationError) {
          this.stateManager.updateCell(
            rowIndex,
            `${ERROR_FIELD_PREFIX}${colKey}`,
            error.message
          );
          redrawNeeded = true;
        } else {
          log("warn", this.options.verbose, error);
        }
      }
    }
    if (cellsToFlashError.length) {
      this.renderer.setTemporaryErrors(cellsToFlashError);
    }
    if (redrawNeeded) {
      if (this.options.autoResizeRowHeight) {
        this.reCalculate();
      }
      this.draw();
    }
    return Array.from(updatedRows);
  }

  public getSelectedCell(): { row: number; colKey: string } | null {
    const cell = this.stateManager.getActiveCell();
    if (!cell || !cell.row || !cell.col) return null;
    return {
      row: cell.row!,
      colKey: this.stateManager.getColumnKey(cell.col!),
    };
  }

  public getRow(rowIndex: number): DataRow | null {
    const row = this.stateManager.getRowData(rowIndex);
    if (!row) return null;
    return JSON.parse(JSON.stringify(row)); // Deep copy
  }
  public getColumns(): string[] {
    return this.stateManager.getColumns().slice(); // Deep copy
  }
  // returns only updated widths
  public getColumnWidths(): Record<string, number> {
    return this.interactionManager.columnWidthMapByKeys();
  }
  public setColumnWidths(widths: Record<string, number>): void {
    Object.entries(widths).forEach(([key, width]) => {
      const colIndex = this.stateManager.getColumns().indexOf(key);
      if (colIndex >= 0) {
        this.stateManager.setColumnWidth(colIndex, width);
      }
    });
    this.redraw();
  }

  public focus(): void {
    this.domManager.focusContainer(false);
  }
  public setValueFromCustomEditor({
    rowIndex,
    colKey,
    value,
  }: CellUpdateInput): void {
    this.focus();
    if (this.editingManager.isEditorActive()) {
      this.editingManager.deactivateEditor(false, true, true);
    }
    const colIndex = this.stateManager.getColumns().indexOf(colKey);
    if (colIndex >= 0) {
      // in case the selection is gone, redraw will be done by updateCell
      this.stateManager.setActiveCell({
        row: rowIndex,
        col: colIndex,
      });
    }
    this.updateCell({ rowIndex, colKey, value });
  }
  public deactivateCustomEditor(focusCell?: VisibleCell): void {
    this.focus();
    this.editingManager.deactivateEditor(false, true, true);
    if (!focusCell) return;
    const colIndex = this.stateManager.getColumns().indexOf(focusCell.colKey);
    if (colIndex < 0) return;
    this.stateManager.setActiveCell({
      row: focusCell.rowIndex,
      col: colIndex,
    });
    this.draw();
  }

  // --- Helper to expose redrawing ---
  public redraw(): void {
    if (this.options.autoResizeRowHeight) {
      this.reCalculate();
    }
    this.draw();
  }
}
