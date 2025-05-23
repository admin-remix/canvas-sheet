import {
  RequiredSpreadsheetOptions,
  CellCoords,
  DataType,
  ColumnSchema,
  CellUpdateEvent,
  CellBounds,
} from "./types";
import { StateManager } from "./state-manager";
import { Renderer } from "./renderer";
import { DimensionCalculator } from "./dimension-calculator";
import { log, validateInput } from "./utils";
import { DomManager } from "./dom-manager";
import { EditingManager } from "./editing-manager"; // Needed for moving active cell
import { ERROR_FIELD_PREFIX } from "./config";

export class InteractionManager {
  private options: RequiredSpreadsheetOptions;
  private stateManager: StateManager;
  private renderer: Renderer;
  private dimensionCalculator: DimensionCalculator;
  private domManager: DomManager;
  private editingManager!: EditingManager; // Use definite assignment assertion
  private lastPasteHandledAt: Date | null = null; // used to prevent multiple pastes in a row
  private ignoreNextScrollTimeout: number | null = null;
  private _customEventHandler: ((event: CustomEvent) => void) | null = null;

  constructor(
    options: RequiredSpreadsheetOptions,
    stateManager: StateManager,
    renderer: Renderer,
    dimensionCalculator: DimensionCalculator,
    domManager: DomManager
  ) {
    this.options = options;
    this.stateManager = stateManager;
    this.renderer = renderer;
    this.dimensionCalculator = dimensionCalculator;
    this.domManager = domManager;
    // editingManager will be set via setter injection after all managers are created
  }

  public bindCustomEvents(
    customEventHandler: ((event: CustomEvent) => void) | null = null
  ): void {
    this._customEventHandler = customEventHandler;
  }

  // optionally scroll a bounds into view
  public triggerCustomEvent(
    eventName: "resize",
    focusBounds?: CellBounds | null
  ): void {
    this._customEventHandler?.call(
      this,
      new CustomEvent(eventName, { detail: focusBounds })
    );
  }

  // Setter for circular dependency
  public setEditingManager(editingManager: EditingManager): void {
    this.editingManager = editingManager;
  }

  public findAdjacentCellByColumnIndex(colIndex: number): CellBounds | null {
    // find which cell is visible before deletion
    const { visibleRowEnd, visibleColStart, visibleColEnd } =
      this.stateManager.getVisibleRange();
    // find the visible cell which is adjacent to the deleted column
    let adjacentColIndex = null;
    if (colIndex > visibleColStart) {
      // If selected column is not the leftmost visible column, use the column to its left
      adjacentColIndex = colIndex - 1;
    } else if (colIndex < visibleColEnd) {
      // If selected column is the leftmost visible column, use the column to its right
      adjacentColIndex = colIndex + 1;
    }
    if (adjacentColIndex !== null && visibleRowEnd !== null) {
      return this.renderer.getCellBounds(visibleRowEnd, adjacentColIndex);
    }
    return null;
  }
  public findAdjacentCellByRowIndex(rowIndex: number): CellBounds | null {
    const { visibleRowStart, visibleRowEnd, visibleColEnd } =
      this.stateManager.getVisibleRange();
    let adjacentRowIndex = null;
    if (rowIndex > visibleRowStart) {
      adjacentRowIndex = rowIndex - 1;
    } else if (rowIndex < visibleRowEnd) {
      adjacentRowIndex = rowIndex + 1;
    }
    if (adjacentRowIndex !== null && visibleColEnd !== null) {
      return this.renderer.getCellBounds(adjacentRowIndex, visibleColEnd);
    }
    return null;
  }

  public canScrollMore(delta: number, vertical: boolean): boolean {
    if (vertical) {
      return delta > 0
        ? this.domManager.canVScrollDown()
        : this.domManager.canVScrollUp();
    } else {
      return delta > 0
        ? this.domManager.canHScrollRight()
        : this.domManager.canHScrollLeft();
    }
  }
  public moveScroll(
    deltaX: number,
    deltaY: number,
    isAbsolute: boolean = false
  ): void {
    const scrollTop = this.domManager.setVScrollPosition(
      isAbsolute ? deltaY : this.domManager.getVScrollPosition() + deltaY
    );
    const scrollLeft = this.domManager.setHScrollPosition(
      isAbsolute ? deltaX : this.domManager.getHScrollPosition() + deltaX
    );
    this.stateManager.updateScroll(scrollTop, scrollLeft);
  }

  public bringBoundsIntoView(bounds: CellBounds): {
    scrollLeft: number;
    scrollTop: number;
  } {
    const scrollLeft = this.domManager.getHScrollPosition();
    const scrollTop = this.domManager.getVScrollPosition();
    const canvasRect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth } = this.options;
    // Adjust bounds coordinates to account for fixed headers and row numbers
    // Convert from content coordinates to viewport coordinates
    const boundsX = bounds.x - scrollLeft;
    const boundsY = bounds.y - scrollTop;
    const boundsWidth = bounds.width;
    const boundsHeight = bounds.height;

    let newScrollLeft = scrollLeft;
    let newScrollTop = scrollTop;

    // Check if the cell is visible horizontally, accounting for rowNumberWidth
    if (boundsX < rowNumberWidth) {
      // Cell is scrolled too far left
      newScrollLeft += boundsX - rowNumberWidth;
    } else if (boundsX + boundsWidth > canvasRect.width) {
      // Cell extends beyond right edge
      newScrollLeft += boundsX + boundsWidth - canvasRect.width;
    }

    // Check if the cell is visible vertically, accounting for headerHeight
    if (boundsY < headerHeight) {
      // Cell is scrolled too far up
      newScrollTop += boundsY - headerHeight;
    } else if (boundsY + boundsHeight > canvasRect.height) {
      // Cell extends beyond bottom edge
      newScrollTop += boundsY + boundsHeight - canvasRect.height;
    }
    // Ensure we don't scroll to negative values
    newScrollLeft = Math.max(0, newScrollLeft);
    newScrollTop = Math.max(0, newScrollTop);

    if (newScrollLeft !== scrollLeft || newScrollTop !== scrollTop) {
      this.moveScroll(newScrollLeft, newScrollTop, true);
    }
    this.ignoreNextScrollTimeout = null; // make sure we don't ignore our current scroll
    this.onScroll(false);
    this.ignoreNextScrollTimeout = setTimeout(() => {
      this.ignoreNextScrollTimeout = null;
    }, 10); // our manual scroll will trigger a new scroll event, so we need to ignore the next one
    return {
      scrollLeft: newScrollLeft,
      scrollTop: newScrollTop,
    };
  }

  public onScroll(hideEditor: boolean = true) {
    if (this.ignoreNextScrollTimeout) {
      clearTimeout(this.ignoreNextScrollTimeout);
      this.ignoreNextScrollTimeout = null;
      return;
    }
    if (hideEditor) {
      // Deactivate editor/dropdown immediately on scroll
      this.editingManager.deactivateEditor(false); // Don't save changes on scroll
      this.editingManager.hideDropdown();
    }

    // Recalculate visible range and redraw
    this.dimensionCalculator.calculateVisibleRange();
    this.renderer.draw();
  }

  // --- Row Selection ---
  /** Returns true if selection state changed */
  public handleRowNumberClick(
    clickedRow: number,
    isShiftKey: boolean,
    isCtrlKey: boolean
  ): boolean {
    log(
      "log",
      this.options.verbose,
      `Row ${clickedRow} clicked. Shift: ${isShiftKey}, Ctrl: ${isCtrlKey}`
    );
    const selectedRows = new Set(this.stateManager.getSelectedRows());
    let lastClickedRow = this.stateManager.getLastClickedRow();

    // Store original state for comparison
    const originalSelectedRowsJson = JSON.stringify(
      Array.from(selectedRows).sort()
    );
    const originalLastClickedRow = lastClickedRow;

    if (isShiftKey && lastClickedRow !== null) {
      // --- Shift Click Logic ---
      const start = Math.min(lastClickedRow, clickedRow);
      const end = Math.max(lastClickedRow, clickedRow);
      // Create new set for shift selection
      const newSelectedRows = new Set<number>();
      for (let i = start; i <= end; i++) {
        newSelectedRows.add(i);
      }
      // Update the state ONLY if the set actually changed
      if (
        JSON.stringify(Array.from(newSelectedRows).sort()) !==
        originalSelectedRowsJson
      ) {
        this.stateManager.setSelectedRows(newSelectedRows, lastClickedRow); // Keep original lastClicked for subsequent shifts
      }
      log(
        "log",
        this.options.verbose,
        "Selected rows (Shift):",
        Array.from(newSelectedRows).sort((a, b) => a - b)
      );
    } else if (isCtrlKey) {
      // --- Ctrl Click Logic ---
      if (selectedRows.has(clickedRow)) {
        selectedRows.delete(clickedRow);
      } else {
        selectedRows.add(clickedRow);
      }
      lastClickedRow = clickedRow; // Update last clicked for subsequent Ctrl/Shift
      this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
      log(
        "log",
        this.options.verbose,
        "Selected rows (Ctrl):",
        Array.from(selectedRows).sort((a, b) => a - b)
      );
    } else {
      // --- Single Click Logic ---
      selectedRows.clear();
      selectedRows.add(clickedRow);
      lastClickedRow = clickedRow;
      this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
      log(
        "log",
        this.options.verbose,
        "Selected rows (Single):",
        Array.from(selectedRows).sort((a, b) => a - b)
      );
    }

    // Check if the primary state actually changed
    const rowsChanged =
      JSON.stringify(Array.from(this.stateManager.getSelectedRows()).sort()) !==
      originalSelectedRowsJson;
    const lastClickChanged =
      this.stateManager.getLastClickedRow() !== originalLastClickedRow;
    const changed = rowsChanged || lastClickChanged;

    // If row selection changed, clear other selections
    if (changed) {
      this.stateManager.setActiveCell(null); // Clear active cell
      this.stateManager.clearSelectionRange(); // Clear cell selection range
      this.stateManager.setSelectedColumn(null); // Clear column selection
    }

    return changed;
  }

  /** Returns true if selection state changed */
  public handleHeaderClick(clickedCol: number): boolean {
    log("log", this.options.verbose, `Column ${clickedCol} clicked.`);
    const selectedColumn = this.stateManager.getSelectedColumn();

    this.stateManager.setSelectedColumn(clickedCol);

    const changed = selectedColumn !== clickedCol;
    // If column selection changed, clear other selections
    if (changed) {
      this.stateManager.setActiveCell(null); // Clear active cell
      this.stateManager.clearSelectionRange(); // Clear cell selection range
      this.stateManager.setSelectedRows(new Set(), null); // Clear row selection
    }

    return changed;
  }

  /** Returns true if selections were cleared */
  public clearSelections(): boolean {
    let changed = false;
    if (this.stateManager.getSelectedRows().size > 0) {
      changed = this.stateManager.setSelectedRows(new Set(), null) || changed;
    }
    if (this.stateManager.getSelectedColumn() !== null) {
      changed = this.stateManager.setSelectedColumn(null) || changed;
    }
    return changed;
  }

  // --- Resizing --- HINT HINT
  public checkResizeHandles(event: MouseEvent): "column" | "row" | null {
    const rect = this.domManager.getCanvasBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const {
      headerHeight,
      rowNumberWidth,
      resizeHandleSize,
      defaultRowHeight,
      defaultColumnWidth,
    } = this.options;

    // Convert to content coordinates based on where in the grid we are
    let contentX: number;
    let contentY: number;

    // Check Column Resize Handles (in header area)
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) {
      contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft();

      // For column resize, we need to check if we're near a column border
      const columns = this.stateManager.getColumns();
      const columnWidths = this.stateManager.getColumnWidths();

      let currentX = 0; // Start at 0 since we've already adjusted for rowNumberWidth
      for (let col = 0; col < columns.length; col++) {
        const colWidth = columnWidths.get(col) || defaultColumnWidth;
        const borderX = currentX + colWidth;
        if (Math.abs(contentX - borderX) <= resizeHandleSize) {
          this._startColumnResize(col, event.clientX);
          return "column";
        }
        currentX += colWidth;
        if (currentX > contentX + resizeHandleSize) break; // Optimization
      }
    }

    // Check Row Resize Handles (in row number area)
    if (canvasX < rowNumberWidth && canvasY >= headerHeight) {
      contentY = canvasY - headerHeight + this.stateManager.getScrollTop();

      // For row resize, we need to check if we're near a row border
      const dataLength = this.stateManager.dataLength;
      const rowHeights = this.stateManager.getRowHeights();

      let currentY = 0; // Start at 0 since we've already adjusted for headerHeight
      for (let row = 0; row < dataLength; row++) {
        const rowHeight = rowHeights.get(row) || defaultRowHeight;
        const borderY = currentY + rowHeight;
        if (Math.abs(contentY - borderY) <= resizeHandleSize) {
          this._startRowResize(row, event.clientY);
          return "row";
        }
        currentY += rowHeight;
        if (currentY > contentY + resizeHandleSize) break; // Optimization
      }
    }

    return null;
  }

  /**
   * Starts column resize operation
   * @param colIndex Column index to resize
   * @param startX Starting X position
   */
  private _startColumnResize(colIndex: number, startX: number): void {
    log(
      "log",
      this.options.verbose,
      `Starting column resize for index ${colIndex}`
    );

    // Deactivate editor/dropdown when column resize starts
    this.editingManager.deactivateEditor(false);
    this.editingManager.hideDropdown();

    // Take a snapshot of the current canvas state for faster rendering during resize
    const canvas = this.domManager.getCanvas();
    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvas.width;
    snapshotCanvas.height = canvas.height;
    const snapshotCtx = snapshotCanvas.getContext("2d");
    if (snapshotCtx) {
      snapshotCtx.drawImage(canvas, 0, 0);
    }

    // Store the original width to calculate delta
    const originalWidth = this.stateManager.getColumnWidth(colIndex);

    this.stateManager.setResizeColumnState({
      isResizing: true,
      columnIndex: colIndex,
      startX: startX,
      canvasSnapshot: snapshotCanvas, // Store the canvas snapshot
      originalWidth: originalWidth, // Store the original width
    });
    this.domManager.setCursor("col-resize");
  }

  /**
   * Starts row resize operation
   * @param rowIndex Row index to resize
   * @param startY Starting Y position
   */
  private _startRowResize(rowIndex: number, startY: number): void {
    log(
      "log",
      this.options.verbose,
      `Starting row resize for index ${rowIndex}`
    );

    // Deactivate editor/dropdown when row resize starts
    this.editingManager.deactivateEditor(false);
    this.editingManager.hideDropdown();

    // Take a snapshot of the current canvas state for faster rendering during resize
    const canvas = this.domManager.getCanvas();
    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = canvas.width;
    snapshotCanvas.height = canvas.height;
    const snapshotCtx = snapshotCanvas.getContext("2d");
    if (snapshotCtx) {
      snapshotCtx.drawImage(canvas, 0, 0);
    }

    // Store the original height to calculate delta
    const originalHeight = this.stateManager.getRowHeight(rowIndex);

    this.stateManager.setResizeRowState({
      isResizing: true,
      rowIndex: rowIndex,
      startY: startY,
      canvasSnapshot: snapshotCanvas, // Store the canvas snapshot
      originalHeight: originalHeight, // Store the original height
    });
    this.domManager.setCursor("row-resize");
  }

  public handleResizeMouseMove(event: MouseEvent): void {
    const { minColumnWidth, maxColumnWidth, minRowHeight, maxRowHeight } =
      this.options;
    const columnResizeState = this.stateManager.getResizeColumnState();
    const rowResizeState = this.stateManager.getResizeRowState();

    if (
      columnResizeState.isResizing &&
      columnResizeState.columnIndex !== null &&
      columnResizeState.startX !== null &&
      columnResizeState.canvasSnapshot
    ) {
      ///// RESIZE COLUMN /////
      // Calculate delta based on original position to avoid accumulating rounding errors
      const deltaX = event.clientX - columnResizeState.startX;
      const colIndex = columnResizeState.columnIndex;

      // Use the original width stored when resize started
      const originalWidth =
        columnResizeState.originalWidth ||
        this.stateManager.getColumnWidth(colIndex);
      let newWidth = originalWidth + deltaX;

      newWidth = Math.max(minColumnWidth, Math.min(newWidth, maxColumnWidth));

      // Only update the width in StateManager, don't recalculate dimensions yet
      this.stateManager.setColumnWidth(colIndex, newWidth);

      // Use the renderer to draw the resize divider
      this.renderer.renderResizeDivider(
        columnResizeState.canvasSnapshot,
        "column",
        colIndex,
        newWidth
      );

      // Don't update the startX so we always compute the delta from the original position
      // This prevents accumulation of rounding errors during resize
    } else if (
      rowResizeState.isResizing &&
      rowResizeState.rowIndex !== null &&
      rowResizeState.startY !== null &&
      rowResizeState.canvasSnapshot
    ) {
      ///// RESIZE ROW /////
      // Calculate delta based on original position to avoid accumulating rounding errors
      const deltaY = event.clientY - rowResizeState.startY;
      const rowIndex = rowResizeState.rowIndex;

      // Use the original height stored when resize started
      const originalHeight =
        rowResizeState.originalHeight ||
        this.stateManager.getRowHeight(rowIndex);
      let newHeight = originalHeight + deltaY;

      newHeight = Math.max(minRowHeight, Math.min(newHeight, maxRowHeight));

      // Only update the height in StateManager, don't recalculate dimensions yet
      this.stateManager.setRowHeight(rowIndex, newHeight);

      // Use the renderer to draw the resize divider
      this.renderer.renderResizeDivider(
        rowResizeState.canvasSnapshot,
        "row",
        rowIndex,
        newHeight
      );

      // Don't update the startY so we always compute the delta from the original position
      // This prevents accumulation of rounding errors during resize
    }
  }

  public resizeRowsForColumn(): void {
    this.dimensionCalculator.autoResizeRowHeights();
    this.dimensionCalculator.calculateTotalSize(); // Recalculate totals
    this.dimensionCalculator.calculateVisibleRange(); // Update visible range
    // Update canvas size if needed
    this.domManager.updateCanvasSize(
      this.stateManager.getTotalContentWidth(),
      this.stateManager.getTotalContentHeight()
    );
    this.renderer.draw();
  }

  public columnWidthMapByKeys(): Record<string, number> {
    return Object.fromEntries(
      Array.from(this.stateManager.getColumnWidths().entries()).map(
        ([index, width]) => [this.stateManager.getColumnKey(index), width]
      )
    );
  }

  public endResize(): void {
    const columnResizeState = this.stateManager.getResizeColumnState();
    const rowResizeState = this.stateManager.getResizeRowState();

    if (columnResizeState.isResizing) {
      log(
        "log",
        this.options.verbose,
        `Finished column resize for index ${
          columnResizeState.columnIndex
        }. New width: ${this.stateManager.getColumnWidth(
          columnResizeState.columnIndex!
        )}`
      );

      // Now perform the actual recalculations that were delayed during drag
      this.dimensionCalculator.calculateTotalSize();

      // Auto-resize row heights if enabled (ensures the final column width is used)
      if (
        this.options.autoResizeRowHeight &&
        columnResizeState.columnIndex !== null
      ) {
        this.resizeRowsForColumn();
      } else {
        // If not auto-resizing rows, still need to update other dimensions
        this.dimensionCalculator.calculateVisibleRange();
        this.domManager.updateCanvasSize(
          this.stateManager.getTotalContentWidth(),
          this.stateManager.getTotalContentHeight()
        );
        // Final full redraw
        this.renderer.draw();
      }

      // Clean up resize state, including the snapshot reference and other properties
      this.stateManager.setResizeColumnState({
        isResizing: false,
        columnIndex: null,
        startX: null,
        canvasSnapshot: undefined,
        originalWidth: undefined,
      });

      try {
        this.options.onColumnWidthsChange?.(this.columnWidthMapByKeys());
      } catch (error) {
        log(
          "error",
          this.options.verbose,
          "Error calling onColumnWidthsChange",
          error
        );
      }
    }
    if (rowResizeState.isResizing) {
      log(
        "log",
        this.options.verbose,
        `Finished row resize for index ${
          rowResizeState.rowIndex
        }. New height: ${this.stateManager.getRowHeight(
          rowResizeState.rowIndex!
        )}`
      );

      // Now perform the actual recalculations that were delayed during drag
      this.dimensionCalculator.calculateTotalSize();
      this.dimensionCalculator.calculateVisibleRange();
      this.domManager.updateCanvasSize(
        this.stateManager.getTotalContentWidth(),
        this.stateManager.getTotalContentHeight()
      );
      // Final full redraw
      this.renderer.draw();

      // Clean up resize state, including the snapshot reference and other properties
      this.stateManager.setResizeRowState({
        isResizing: false,
        rowIndex: null,
        startY: null,
        canvasSnapshot: undefined,
        originalHeight: undefined,
      });
    }

    // Cursor update is handled by mouse move/up handler
  }

  public updateCursorStyle(event: MouseEvent): void {
    if (
      this.stateManager.isResizing() ||
      this.stateManager.isDraggingFillHandle()
    )
      return; // Don't change cursor during active drag/resize

    const rect = this.domManager.getCanvasBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const {
      headerHeight,
      rowNumberWidth,
      resizeHandleSize,
      defaultRowHeight,
      defaultColumnWidth,
    } = this.options;

    // Convert to content coordinates based on where the mouse is
    let contentX: number;
    let contentY: number;

    // In header area (for column resize)
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) {
      contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft();
      contentY = canvasY;
    }
    // In row number area (for row resize)
    else if (canvasX < rowNumberWidth && canvasY >= headerHeight) {
      contentX = canvasX;
      contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    }
    // In content area (for fill handle)
    else if (canvasX >= rowNumberWidth && canvasY >= headerHeight) {
      contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft();
      contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    }
    // In corner box or outside
    else {
      contentX = canvasX;
      contentY = canvasY;
    }

    const columns = this.stateManager.getColumns();
    const dataLength = this.stateManager.dataLength;
    const columnWidths = this.stateManager.getColumnWidths();
    const rowHeights = this.stateManager.getRowHeights();

    let newCursor = "default";

    // Check Column Resize Handles
    if (canvasY < headerHeight && canvasX >= rowNumberWidth) {
      let currentX = 0; // Start at 0 since we already adjusted for rowNumberWidth in contentX
      for (let col = 0; col < columns.length; col++) {
        const colWidth = columnWidths.get(col) || defaultColumnWidth;
        const borderX = currentX + colWidth;
        if (Math.abs(contentX - borderX) <= resizeHandleSize) {
          newCursor = "col-resize";
          break;
        }
        currentX += colWidth;
        if (currentX > contentX + resizeHandleSize) break; // Optimization
      }
    }

    // Check Row Resize Handles
    if (
      newCursor === "default" &&
      canvasX < rowNumberWidth &&
      canvasY >= headerHeight
    ) {
      let currentY = 0; // Start at 0 since we already adjusted for headerHeight in contentY
      for (let row = 0; row < dataLength; row++) {
        const rowHeight = rowHeights.get(row) || defaultRowHeight;
        const borderY = currentY + rowHeight;
        if (Math.abs(contentY - borderY) <= resizeHandleSize) {
          newCursor = "row-resize";
          break;
        }
        currentY += rowHeight;
        if (currentY > contentY + resizeHandleSize) break; // Optimization
      }
    }

    // Check Fill Handle
    const activeCell = this.stateManager.getActiveCell();
    if (
      newCursor === "default" &&
      activeCell &&
      activeCell.row !== null &&
      activeCell.col !== null &&
      !this.stateManager.getActiveEditor() &&
      canvasX >= rowNumberWidth &&
      canvasY >= headerHeight
    ) {
      const handleBounds = this.renderer.getFillHandleBounds(
        activeCell.row,
        activeCell.col
      );
      if (
        handleBounds &&
        contentX >= handleBounds.x &&
        contentX <= handleBounds.x + handleBounds.width &&
        contentY >= handleBounds.y &&
        contentY <= handleBounds.y + handleBounds.height
      ) {
        newCursor = "crosshair";
      }
    }

    this.domManager.setCursor(newCursor);
  }

  // --- Fill Handle --- HINT HINT
  public checkFillHandle(event: MouseEvent): boolean {
    const activeCell = this.stateManager.getActiveCell();
    if (
      !activeCell ||
      this.stateManager.getActiveEditor() ||
      this.stateManager.isResizing() ||
      activeCell.row === null ||
      activeCell.col === null
    ) {
      return false;
    }

    const handleBounds = this.renderer.getFillHandleBounds(
      activeCell.row,
      activeCell.col
    );
    if (!handleBounds) return false;

    const rect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth } = this.options;

    // Convert mouse position to content coordinates, accounting for fixed headers/row numbers
    // and scrolling position
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    let contentX, contentY;

    // If in content area, adjust for header and row number and add scroll offset
    if (canvasX >= rowNumberWidth && canvasY >= headerHeight) {
      contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft();
      contentY = canvasY - headerHeight + this.stateManager.getScrollTop();
    } else {
      // Not in content area, can't be on the fill handle
      return false;
    }

    if (
      contentX >= handleBounds.x &&
      contentX <= handleBounds.x + handleBounds.width &&
      contentY >= handleBounds.y &&
      contentY <= handleBounds.y + handleBounds.height
    ) {
      this._startFillHandleDrag(activeCell);
      return true;
    }
    return false;
  }

  private _startFillHandleDrag(startCell: CellCoords): void {
    if (startCell.row === null || startCell.col === null) return;

    // Deactivate editor/dropdown when fill handle drag starts
    this.editingManager.deactivateEditor(false);
    this.editingManager.hideDropdown();

    this.stateManager.setDragState({
      isDragging: true,
      startCell: { ...startCell },
      endRow: startCell.row, // Initially end row is the start row
    });
    this.domManager.setCursor("crosshair");
    log(
      "log",
      this.options.verbose,
      "Started dragging fill handle from",
      startCell
    );
  }

  public handleFillHandleMouseMove(event: MouseEvent): void {
    if (!this.stateManager.isDraggingFillHandle()) return;

    const startCell = this.stateManager.getDragStartCell();
    if (!startCell || startCell.row === null) return;

    const rect = this.domManager.getCanvasBoundingClientRect();
    const { headerHeight, rowNumberWidth, defaultRowHeight } = this.options;
    const canvasY = event.clientY - rect.top;

    // Only proceed if we're in the content area or row number area
    if (canvasY < headerHeight) {
      // Mouse is above the header, clamp to first row
      this.stateManager.setDragState({
        isDragging: true,
        startCell: startCell,
        endRow: 0,
      });
      this.renderer.draw();
      return;
    }

    // Adjust for header height and add scroll offset to get content Y coordinate
    const contentY = canvasY - headerHeight + this.stateManager.getScrollTop();

    const rowHeights = this.stateManager.getRowHeights();
    const dataLength = this.stateManager.dataLength;

    let targetRow: number | null = null;
    let currentY = 0; // Start at 0 since we've adjusted for header height

    for (let i = 0; i < dataLength; i++) {
      const rowHeight = rowHeights.get(i) || defaultRowHeight;
      if (contentY >= currentY && contentY < currentY + rowHeight) {
        targetRow = i;
        break;
      }
      currentY += rowHeight;
      if (currentY > contentY) break; // Optimization
    }

    let newEndRow = this.stateManager.getDragEndRow();

    if (targetRow !== null) {
      // Allow dragging in any direction (up or down)
      newEndRow = targetRow;
    } else {
      // Mouse is below the last row, clamp to last row
      newEndRow = dataLength - 1;
    }

    if (newEndRow !== this.stateManager.getDragEndRow()) {
      this.stateManager.setDragState({
        // Only update endRow
        isDragging: true,
        startCell: startCell,
        endRow: newEndRow,
      });
      this.renderer.draw(); // Redraw to show the updated drag range
    }
  }

  public endFillHandleDrag(): void {
    if (!this.stateManager.isDraggingFillHandle()) return;

    const dragEndRow = this.stateManager.getDragEndRow();
    log(
      "log",
      this.options.verbose,
      "Finished dragging fill handle to row",
      dragEndRow
    );

    this._performFill();

    this.stateManager.setDragState({
      isDragging: false,
      startCell: null,
      endRow: null,
    });

    // Cursor update handled by general mouse up handler
    // Redraw happens because state changed and is needed after fill
  }

  private _performFill(): void {
    const dragState = this.stateManager.getDragState();
    // Add explicit checks for startCell and endRow being non-null
    if (
      !dragState.isDragging ||
      !dragState.startCell ||
      dragState.endRow === null ||
      dragState.startCell.row === null
    ) {
      return;
    }

    const { verbose, autoResizeRowHeight } = this.options;

    // Now we know startCell and endRow are not null
    const startCell = dragState.startCell; // Assign to new const for type narrowing
    const endRow = dragState.endRow; // Assign to new const for type narrowing
    const startRow = startCell.row;
    const startCol = startCell.col;
    if (startCol === null || startRow === null) return;
    const sourceValue = this.stateManager.getCellData(startRow, startCol);
    const sourceSchema = this.stateManager.getSchemaForColumn(startCol);
    const sourceColumnKey = this.stateManager.getColumnKey(startCol);
    const sourceType = sourceSchema?.type;
    let changed = false;
    const dataLength = this.stateManager.dataLength; // Cache length

    // Determine direction and set proper loop bounds
    const isFillingDown = endRow >= startRow;
    const firstRow = isFillingDown ? startRow + 1 : endRow;
    const lastRow = isFillingDown ? endRow : startRow - 1;
    const cellUpdates: number[] = [];
    const oldRows: any[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      if (row < 0 || row >= dataLength) continue; // Ensure row index is valid

      const targetSchema = this.stateManager.getSchemaForColumn(startCol);
      const isDisabledCell = this.stateManager.isCellDisabled(row, startCol);

      if (isDisabledCell) {
        log(
          "log",
          verbose,
          `Skipping fill for disabled cell ${row},${startCol}`
        );
        continue;
      }

      // Optional: Keep type check for robustness
      if (targetSchema?.type !== sourceType) {
        log(
          "log",
          verbose,
          `Skipping fill for row ${row}: Type mismatch (Source: ${sourceType}, Target: ${targetSchema?.type})`
        );
        continue;
      }

      const currentValue = this.stateManager.getCellData(row, startCol);
      if (currentValue !== sourceValue) {
        // Use StateManager to update the cell value internally
        const oldValue = this.stateManager.updateCellInternal(
          row,
          startCol,
          sourceValue
        );
        // Crucially, update disabled states for the row *after* changing the value
        cellUpdates.push(row);
        oldRows.push({ [sourceColumnKey]: oldValue });
        changed = true;
      }
    }

    if (changed) {
      if (autoResizeRowHeight) {
        this.resizeRowsForColumn();
      } else {
        this.renderer.draw();
      }
    }

    if (cellUpdates.length > 0) {
      this._batchUpdateCellsAndNotify(cellUpdates, [sourceColumnKey], oldRows);
    }
  }

  /**
   * Helper method to optimize multiple cell updates followed by row disabled state updates
   * This replaces the pattern of calling updateCellInternal in a loop followed by updateDisabledStatesForRow
   * @param updates List of row, column, value updates to apply
   */
  public _batchUpdateCellsAndNotify(
    rows: number[],
    updateColumns: string[],
    oldRows?: any[]
  ): void {
    if (!rows || rows.length === 0) return;
    // Then update disabled states for each affected row
    const updatedRows: CellUpdateEvent[] = [];
    rows.forEach((rowIndex, index) => {
      this.stateManager.updateDisabledStatesForRow(rowIndex);
      updatedRows.push({
        rowIndex,
        columnKeys: updateColumns,
        data: this.stateManager.getRowData(rowIndex)!,
        oldData: oldRows?.[index],
      });
    });

    // Notify about updates (once per batch)
    if (updatedRows.length > 0) {
      this.stateManager.callOnCellsUpdate(updatedRows);
    }
  }

  // --- Copy/Paste ---
  /** Copies the active cell or selected range. Returns true if copy state changed. */
  public copy(): boolean {
    const activeCell = this.stateManager.getActiveCell();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();
    let changed = false;

    if (selectionRange) {
      // Copy range data
      const { start, end } = selectionRange;
      const rangeData: any[][] = [];
      let allTypesMatch = true;
      let firstType: DataType | undefined = undefined;

      for (let r = start.row!; r <= end.row!; r++) {
        const rowData: any[] = [];
        for (let c = start.col!; c <= end.col!; c++) {
          const value = this.stateManager.getCellData(r, c);
          rowData.push(value);

          // Check type consistency
          const type = this.stateManager.getSchemaForColumn(c)?.type;
          if (r === start.row! && c === start.col!) {
            firstType = type;
          } else if (type !== firstType) {
            allTypesMatch = false;
          }
        }
        rangeData.push(rowData);
      }

      if (!allTypesMatch) {
        log(
          "warn",
          this.options.verbose,
          "Copied range contains mixed data types."
        );
        // Decide if copy should be prevented or allowed with warning
      }

      // Store both the data and the source range
      changed = this.stateManager.setCopiedRange(rangeData, selectionRange);
      log(
        "log",
        this.options.verbose,
        `Copied range data [${rangeData.length}x${rangeData[0]?.length}] from source range [${start.row},${start.col}] -> [${end.row},${end.col}]`
      );
    } else if (
      activeCell &&
      activeCell.row !== null &&
      activeCell.col !== null
    ) {
      // Copy single cell (this already clears range state via setCopiedValue)
      const { row, col } = activeCell;
      const value = this.stateManager.getCellData(row, col);
      const type = this.stateManager.getSchemaForColumn(col)?.type;
      changed = this.stateManager.setCopiedValue(value, type, {
        ...activeCell,
      });
      if (changed) {
        log(
          "log",
          this.options.verbose,
          `Copied value: ${value} (Type: ${type}) from cell ${row},${col}`
        );
      }
    }
    return changed;
  }

  /** Pastes single value or range. Returns true if paste occurred and requires redraw. */
  public paste(): boolean {
    if (
      this.lastPasteHandledAt &&
      Date.now() - this.lastPasteHandledAt.getTime() < 1000
    ) {
      return false;
    }
    this.lastPasteHandledAt = new Date();

    log("log", this.options.verbose, "Paste requested by keyboard shortcut");
    // Check if we have anything to paste
    const activeCell = this.stateManager.getActiveCell();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();
    const copiedValue = this.stateManager.getCopiedValue();
    const copiedValueType = this.stateManager.getCopiedValueType();
    const copiedRangeData = this.stateManager.getCopiedRangeData();

    // TODO: Handle row selection paste
    // const selectedRows = this.stateManager.getSelectedRows();

    // Regular paste to cell or range
    const targetRange = selectionRange;
    const targetCell = !targetRange && activeCell ? activeCell : null;

    if (!targetRange && !targetCell) {
      log(
        "log",
        this.options.verbose,
        "Paste ignored: No target cell or range selected."
      );
      return false;
    }

    if (copiedRangeData) {
      log("log", this.options.verbose, "Pasting range data");
      // Always paste range data into range (if targetRange) or from top-left (if activeCell)
      if (targetRange) {
        return this._pasteRangeToRange(targetRange, copiedRangeData);
      } else if (
        targetCell &&
        targetCell.row !== null &&
        targetCell.col !== null
      ) {
        return this._pasteRangeFromTopLeft(targetCell, copiedRangeData);
      } else {
        return false;
      }
    } else if (copiedValue !== undefined) {
      log("log", this.options.verbose, "Pasting single value");
      // Always paste the single value into range (if targetRange) or cell (if activeCell)
      if (targetRange) {
        return this._pasteSingleValueToRange(
          targetRange,
          copiedValue,
          copiedValueType
        );
      } else if (
        targetCell &&
        targetCell.row !== null &&
        targetCell.col !== null
      ) {
        return this._pasteSingleValue(targetCell, copiedValue, copiedValueType);
      } else {
        return false;
      }
    } else {
      log("log", this.options.verbose, "Nothing to paste.");
      return false;
    }
  }

  /** Case 1: Paste single value to single cell */
  private _pasteSingleValue(
    targetCell: CellCoords,
    value: any,
    valueType: DataType | undefined
  ): boolean {
    if (targetCell.row === null || targetCell.col === null) return false;

    const targetRow = targetCell.row;
    const targetCol = targetCell.col;
    const targetColKey = this.stateManager.getColumnKey(targetCol);
    const targetSchema = this.stateManager.getSchemaForColumn(targetCol);

    if (this.stateManager.isCellDisabled(targetRow, targetCol)) {
      log(
        "log",
        this.options.verbose,
        `Paste cancelled: Target cell ${targetRow},${targetCol} is disabled.`
      );
      return false;
    }

    if (targetSchema?.type !== valueType && value !== null) {
      log(
        "log",
        this.options.verbose,
        `Type mismatch (Copied: ${valueType}, Target: ${targetSchema?.type}) - attempting conversion.`
      );
      // We'll try to convert the value to match the target schema
      const convertedValue = this._convertValueForTargetType(
        value,
        targetColKey,
        targetSchema
      );
      if (convertedValue === null) {
        log(
          "log",
          this.options.verbose,
          `Paste cancelled: Cannot convert value between types.`
        );
        return false;
      }
      value = convertedValue;
    }
    const currentValue = this.stateManager.getCellData(targetRow, targetCol);
    const validationResult = validateInput(
      value,
      targetSchema,
      targetColKey,
      this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
      this.options.verbose,
      this.stateManager.getData(true),
      targetRow
    );
    if ("error" in validationResult) {
      log("log", this.options.verbose, validationResult.error);
      if (validationResult.errorType === "required" && !currentValue) {
        this.stateManager.updateCell(
          targetRow,
          `${ERROR_FIELD_PREFIX}${targetColKey}`,
          validationResult.error
        );
      } else {
        this.renderer.setTemporaryErrors([
          { row: targetRow, col: targetCol, error: validationResult.error },
        ]);
      }
      return true; // redraw required for error
    } else {
      this.stateManager.removeCellValue(
        targetRow,
        `${ERROR_FIELD_PREFIX}${targetColKey}`
      );
    }
    if (currentValue !== value) {
      const oldValue = this.stateManager.updateCellInternal(
        targetRow,
        targetCol,
        value
      );
      this._batchUpdateCellsAndNotify(
        [targetRow],
        [targetColKey],
        [{ [targetColKey]: oldValue }]
      );
      log(
        "log",
        this.options.verbose,
        `Pasted value ${value} to cell ${targetRow},${targetCol}`
      );
      return true;
    }
    return false;
  }

  /** Case 2: Paste single value to a selected range */
  private _pasteSingleValueToRange(
    targetRange: { start: CellCoords; end: CellCoords },
    value: any,
    valueType: DataType | undefined
  ): boolean {
    let changed = false;
    const affectedRows: number[] = [];
    const affectedColumns: string[] = [];
    const oldRows = new Map<number, any>();
    for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
      for (
        let col = targetRange.start.col!;
        col <= targetRange.end.col!;
        col++
      ) {
        const targetColKey = this.stateManager.getColumnKey(col);
        const targetSchema = this.stateManager.getSchemaForColumn(col);

        // Skip if disabled
        if (this.stateManager.isCellDisabled(row, col)) continue;

        // Handle type conversion if needed
        let valueToUse = value;
        if (targetSchema?.type !== valueType && value !== null) {
          valueToUse = this._convertValueForTargetType(
            value,
            targetColKey,
            targetSchema
          );
          if (valueToUse === null) continue; // Skip if conversion not possible
        }

        const currentValue = this.stateManager.getCellData(row, col);
        // Validate value for the target cell
        const validationResult = validateInput(
          valueToUse,
          targetSchema,
          targetColKey,
          this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
          this.options.verbose,
          this.stateManager.getData(true),
          row
        );
        if ("error" in validationResult) {
          log("warn", this.options.verbose, validationResult.error);
          if (validationResult.errorType === "required" && !currentValue) {
            this.stateManager.updateCell(
              row,
              `${ERROR_FIELD_PREFIX}${targetColKey}`,
              validationResult.error
            );
          } else {
            this.renderer.setTemporaryErrors([
              { row, col, error: validationResult.error },
            ]);
          }
          changed = true;
          // TODO: add to affectedRows and affectedColumns
          continue;
        } else {
          this.stateManager.removeCellValue(
            row,
            `${ERROR_FIELD_PREFIX}${targetColKey}`
          );
        }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(
            row,
            col,
            valueToUse
          );
          affectedRows.push(row);
          affectedColumns.push(targetColKey);
          oldRows.set(row, { ...oldRows.get(row), [targetColKey]: oldValue });
          changed = true;
        }
      }
    }

    // Update disabled states for all affected rows
    if (affectedRows.length > 0) {
      this._batchUpdateCellsAndNotify(
        affectedRows,
        affectedColumns,
        affectedRows.map((m) => oldRows.get(m))
      );
      log(
        "log",
        this.options.verbose,
        `Pasted single value to range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`
      );
    }

    return changed;
  }

  /** Helper method to convert values between different data types */
  private _convertValueForTargetType(
    value: any,
    colKey: string,
    schema?: ColumnSchema
  ): any {
    const targetType = schema?.type;
    if (value === null || value === undefined || targetType === undefined) {
      return null;
    }

    // Handle array input
    if (Array.isArray(value)) {
      // If the target is an array type (e.g., multiple)
      if (schema?.multiple) {
        // For multiple select, try to convert each item in the array
        return value
          .map((item) =>
            this._convertValueForTargetType(item, colKey, {
              ...schema,
              multiple: false, // Treat each item as single value conversion
            })
          )
          .filter((item) => item !== null);
      }

      // For non-array target types, use the first value from the array if available
      return value.length > 0
        ? this._convertValueForTargetType(value[0], colKey, schema)
        : null;
    }

    // Convert any value to string for display/text fields
    if (targetType === "text" || targetType === "email") {
      if (schema?.autoTrim) {
        return String(value).trim();
      }
      return String(value);
    }

    const stringValue = String(value).trim();
    if (stringValue === "") return null;

    switch (targetType) {
      case "number":
        const num = parseFloat(stringValue);
        return isNaN(num) ? null : num;

      case "boolean":
        if (typeof value === "boolean") return value;
        const lower = stringValue.toLowerCase();
        if (["true", "yes", "1", "y"].includes(lower)) return true;
        if (["false", "no", "0", "n"].includes(lower)) return false;
        return null;

      case "date":
        if (value instanceof Date) return value.toISOString().split("T")[0];

        try {
          // Handle numeric timestamps and various date formats
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split("T")[0]; // YYYY-MM-DD format
          }
        } catch (e) {}
        return null;

      case "select":
        // For select, we need to check if the value matches any option id or name
        const cachedOptions =
          this.stateManager.cachedDropdownOptionsByColumn.get(colKey);
        if (!cachedOptions) return null;

        // Try to match by raw id
        if (cachedOptions.has(value)) return value;

        // Try to match by string value id if the original value is not a string
        if (typeof value !== "string" && cachedOptions.has(stringValue))
          return stringValue;

        // If not found by id, try to match by name
        const option = Array.from(cachedOptions.entries()).find(
          ([_key, option]) => option.toLowerCase() === stringValue.toLowerCase()
        );

        // If schema allows multiple values, wrap the result in an array
        if (schema?.multiple && option) {
          return [option[0]];
        }

        return option ? option[0] : null;
      default:
        return null;
    }
  }

  /** Case 3: Paste range starting from a single top-left cell */
  private _pasteRangeFromTopLeft(
    startCell: CellCoords,
    rangeData: any[][]
  ): boolean {
    if (
      startCell.row === null ||
      startCell.col === null ||
      !rangeData ||
      rangeData.length === 0
    ) {
      return false;
    }
    const startRow = startCell.row;
    const startCol = startCell.col;
    const numRowsToPaste = rangeData.length;
    const numColsToPaste = rangeData[0]?.length || 0;
    let changed = false;
    const totalRows = this.stateManager.dataLength;
    const totalCols = this.stateManager.getColumns().length;
    const affectedRows: number[] = [];
    const affectedColumns = new Set<string>();
    const oldRows = new Map<number, any>();

    for (let rOffset = 0; rOffset < numRowsToPaste; rOffset++) {
      const targetRow = startRow + rOffset;
      if (targetRow >= totalRows) break;

      const pastedRowData = rangeData[rOffset];
      let rowChanged = false;

      for (let cOffset = 0; cOffset < numColsToPaste; cOffset++) {
        const targetCol = startCol + cOffset;
        if (targetCol >= totalCols) break;

        const valueToPaste = pastedRowData[cOffset];
        const targetColKey = this.stateManager.getColumnKey(targetCol);
        const targetSchema = this.stateManager.getSchemaForColumn(targetCol);

        if (this.stateManager.isCellDisabled(targetRow, targetCol)) continue;

        // Handle type conversion if needed
        let valueToUse = valueToPaste;
        if (valueToUse !== null) {
          valueToUse = this._convertValueForTargetType(
            valueToPaste,
            targetColKey,
            targetSchema
          );
          if (valueToUse === null) continue; // Skip if conversion not possible
        }

        const currentValue = this.stateManager.getCellData(
          targetRow,
          targetCol
        );
        const validationResult = validateInput(
          valueToUse,
          targetSchema,
          targetColKey,
          this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
          this.options.verbose,
          this.stateManager.getData(true),
          targetRow
        );
        if ("error" in validationResult) {
          log("warn", this.options.verbose, validationResult.error);
          if (validationResult.errorType === "required" && !currentValue) {
            this.stateManager.updateCell(
              targetRow,
              `${ERROR_FIELD_PREFIX}${targetColKey}`,
              validationResult.error
            );
          } else {
            this.renderer.setTemporaryErrors([
              { row: targetRow, col: targetCol, error: validationResult.error },
            ]);
          }
          changed = true;
          // TODO: add to affectedRows and affectedColumns
          continue;
        } else {
          this.stateManager.removeCellValue(
            targetRow,
            `${ERROR_FIELD_PREFIX}${targetColKey}`
          );
        }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(
            targetRow,
            targetCol,
            valueToUse
          );
          rowChanged = true;
          affectedColumns.add(targetColKey);
          oldRows.set(targetRow, {
            ...oldRows.get(targetRow),
            [targetColKey]: oldValue,
          });
        }
      }

      if (rowChanged) {
        affectedRows.push(targetRow);
        changed = true;
      }
    }

    if (affectedRows.length > 0) {
      this._batchUpdateCellsAndNotify(
        affectedRows,
        Array.from(affectedColumns),
        affectedRows.map((m) => oldRows.get(m))
      );
      log(
        "log",
        this.options.verbose,
        `Pasted range [${numRowsToPaste}x${numColsToPaste}] starting at ${startRow},${startCol}`
      );
    }

    return changed;
  }

  /** Case 4: Paste range into a selected range (repeating pattern) */
  private _pasteRangeToRange(
    targetRange: { start: CellCoords; end: CellCoords },
    sourceRangeData: any[][]
  ): boolean {
    if (!sourceRangeData || sourceRangeData.length === 0) return false;
    const sourceRows = sourceRangeData.length;
    const sourceCols = sourceRangeData[0]?.length || 0;
    if (sourceCols === 0) return false;

    let changed = false;
    const affectedRows: number[] = [];
    const affectedColumns = new Set<string>();
    const oldRows = new Map<number, any>();

    for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
      let rowChanged = false;
      for (
        let col = targetRange.start.col!;
        col <= targetRange.end.col!;
        col++
      ) {
        // Calculate corresponding source cell using modulo for pattern repetition
        const sourceRowIndex = (row - targetRange.start.row!) % sourceRows;
        const sourceColIndex = (col - targetRange.start.col!) % sourceCols;
        const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex];

        const targetColKey = this.stateManager.getColumnKey(col);
        const targetSchema = this.stateManager.getSchemaForColumn(col);

        // Skip if disabled
        if (this.stateManager.isCellDisabled(row, col)) continue;

        // Handle type conversion if needed
        let valueToUse = valueToPaste;
        if (valueToUse !== null) {
          valueToUse = this._convertValueForTargetType(
            valueToPaste,
            targetColKey,
            targetSchema
          );
          if (valueToUse === null) continue; // Skip if conversion not possible
        }

        const currentValue = this.stateManager.getCellData(row, col);
        // Validate value
        const validationResult = validateInput(
          valueToUse,
          targetSchema,
          targetColKey,
          this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
          this.options.verbose,
          this.stateManager.getData(true),
          row
        );
        if ("error" in validationResult) {
          log("warn", this.options.verbose, validationResult.error);
          if (validationResult.errorType === "required" && !currentValue) {
            this.stateManager.updateCell(
              row,
              `${ERROR_FIELD_PREFIX}${targetColKey}`,
              validationResult.error
            );
          } else {
            this.renderer.setTemporaryErrors([
              { row, col, error: validationResult.error },
            ]);
          }
          changed = true;
          // TODO: add to affectedRows and affectedColumns
          continue;
        } else {
          this.stateManager.removeCellValue(
            row,
            `${ERROR_FIELD_PREFIX}${targetColKey}`
          );
        }

        if (currentValue !== valueToUse) {
          const oldValue = this.stateManager.updateCellInternal(
            row,
            col,
            valueToUse
          );
          rowChanged = true;
          affectedColumns.add(targetColKey);
          oldRows.set(row, { ...oldRows.get(row), [targetColKey]: oldValue });
        }
      }
      if (rowChanged) {
        affectedRows.push(row);
        changed = true;
      }
    }

    if (affectedRows.length > 0) {
      this._batchUpdateCellsAndNotify(
        affectedRows,
        Array.from(affectedColumns),
        affectedRows.map((m) => oldRows.get(m))
      );
      log(
        "log",
        this.options.verbose,
        `Pasted range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`
      );
    }

    return changed;
  }

  /** Clears all copy state. Returns true if state changed. */
  public clearCopiedCell(): boolean {
    return this.stateManager.clearCopyState();
  }

  // --- Deletion --- HINT HINT
  /** Returns true if rows were deleted */
  public deleteSelectedRows(): boolean {
    const selectedRows = this.stateManager.getSelectedRows();
    if (selectedRows.size === 0) return false;

    const rowsToDelete = Array.from(selectedRows);
    log("log", this.options.verbose, "Deleting rows:", rowsToDelete);

    const selectedRowData = rowsToDelete
      .map((rowIndex) => this.stateManager.getRowData(rowIndex)!)
      .filter((row) => row);
    let deletedCount = this.stateManager.deleteRows(rowsToDelete);
    try {
      this.options.onRowDeleted?.(selectedRowData);
    } catch (error) {
      log(
        "error",
        this.options.verbose,
        `Error calling onRowDeleted: ${error}`
      );
    }

    if (deletedCount > 0) {
      this.clearSelections();
      this.stateManager.setActiveCell(null);
      this.clearCopiedCell();

      // Recalculate everything after deletion
      this.triggerCustomEvent("resize");
      return true; // Indicate redraw needed
    }
    return false;
  }

  // --- Selection Drag ---

  /** Starts a cell selection drag. Returns true if state changed */
  public startSelectionDrag(startCoords: CellCoords): boolean {
    if (startCoords.row === null || startCoords.col === null) return false;

    let primaryChanged = false;
    this.stateManager.setDraggingSelection(true);

    // Update primary states
    const activeChanged = this.stateManager.setActiveCell(startCoords);
    const rangeChanged = this.stateManager.setSelectionRange(
      startCoords,
      startCoords
    );
    primaryChanged = activeChanged || rangeChanged;

    // If primary state changed, clear other selection types
    let rowsCleared = false;
    if (primaryChanged) {
      rowsCleared = this.clearSelections();
    }

    if (primaryChanged || rowsCleared) {
      log(
        "log",
        this.options.verbose,
        `Started selection drag at ${startCoords.row},${startCoords.col}`
      );
      return true;
    }
    return false;
  }

  /** Updates the end cell of the selection drag */
  public updateSelectionDrag(endCoords: CellCoords): boolean {
    if (
      !this.stateManager.getIsDraggingSelection() ||
      !this.stateManager.getSelectionStartCell()
    ) {
      return false;
    }
    // Only update if the end cell is valid
    if (endCoords.row === null || endCoords.col === null) return false;

    // Only redraw if the end cell actually changes
    const currentEnd = this.stateManager.getSelectionEndCell();
    if (
      currentEnd?.row !== endCoords.row ||
      currentEnd?.col !== endCoords.col
    ) {
      log(
        "log",
        this.options.verbose,
        `Updating selection drag to ${endCoords.row},${endCoords.col}`
      );
      // Keep the original start cell, only update the end cell
      return this.stateManager.setSelectionRange(
        this.stateManager.getSelectionStartCell(),
        endCoords
      );
    }
    return false;
  }

  /** Ends the cell selection drag */
  public endSelectionDrag(): void {
    if (this.stateManager.getIsDraggingSelection()) {
      log(
        "log",
        this.options.verbose,
        `Ended selection drag. Final range: ${JSON.stringify(
          this.stateManager.getNormalizedSelectionRange()
        )}`
      );
      this.stateManager.setDraggingSelection(false);
      // Final range is already set by updateSelectionDrag
    }
  }

  // --- Cell Navigation (used by editing manager on Enter/Tab) ---
  // returns true if redraw is needed
  public moveActiveCell(
    rowDelta: number,
    colDelta: number,
    activateEditor = true
  ): boolean {
    const { verbose, autoAddNewRow } = this.options;
    if (!this.editingManager) {
      log("warn", verbose, "EditingManager not set, cannot move active cell.");
      return false;
    }
    const shouldAddRow = autoAddNewRow && activateEditor;
    const currentActiveCell = this.stateManager.getActiveCell();
    if (
      !currentActiveCell ||
      currentActiveCell.row === null ||
      currentActiveCell.col === null
    )
      return false;

    let currentRow = currentActiveCell.row;
    let currentCol = currentActiveCell.col;
    let numRows = this.stateManager.dataLength;
    const numCols = this.stateManager.getColumns().length;

    // Simple move first
    let nextRow = currentRow + rowDelta;
    let nextCol = currentCol + colDelta;

    // Wrap around columns/rows
    if (nextCol >= numCols) {
      nextCol = 0;
      nextRow++;
    } else if (nextCol < 0) {
      nextCol = numCols - 1;
      nextRow--;
    }

    // Check bounds
    if (nextRow < 0 || (nextRow >= numRows && !shouldAddRow)) {
      // Reached top/bottom edge, deactivate editing and don't move
      this.editingManager.deactivateEditor(true); // Save previous cell
      this.stateManager.setActiveCell(null);
      log("log", verbose, "Reached grid boundary, deactivating editor.");
      return true;
    }

    if (nextRow === numRows && shouldAddRow) {
      // Reached bottom edge, add a new row
      nextRow = this.stateManager.addRow();
      // trigger resize to recalculate dimensions
      this.triggerCustomEvent("resize");
      numRows++;
    }

    // Find the next *editable* cell in the specified direction
    // This is a simplified search; a more robust one might be needed for large sparse disabled areas
    let safetyCounter = nextRow * numCols + nextCol; // start at current cell
    const maxSearch = numRows * numCols; // Limit search iterations

    while (
      this.stateManager.isCellDisabled(nextRow, nextCol) &&
      safetyCounter < maxSearch
    ) {
      safetyCounter++;
      nextRow += rowDelta;
      nextCol += colDelta;

      // Wrap around again if needed during search
      if (nextCol >= numCols) {
        nextCol = 0;
        nextRow++;
      } else if (nextCol < 0) {
        nextCol = numCols - 1;
        nextRow--;
      }

      // If search goes out of bounds, stop
      if (nextRow < 0 || nextRow >= numRows) {
        this.editingManager.deactivateEditor(true); // Save previous cell
        this.stateManager.setActiveCell(null);
        log("warn", verbose, "Could not find next editable cell in direction.");
        return true;
      }
    }

    if (safetyCounter >= maxSearch) {
      log(
        "warn",
        verbose,
        "Max search limit reached while finding next editable cell."
      );
      this.editingManager.deactivateEditor(true);
      this.stateManager.setActiveCell(null);
      return true;
    }
    // Found the next editable cell
    this.stateManager.setActiveCell({ row: nextRow, col: nextCol });
    if (activateEditor) {
      // Activate the editor in the new cell
      this.editingManager.activateEditor(nextRow, nextCol);
      // activateEditor will handle the redraw
    } else {
      const bounds = this.renderer.getCellBounds(nextRow, nextCol);
      if (bounds) {
        this.bringBoundsIntoView(bounds);
      }
    }
    return true;
  }

  // --- External Paste Handlers (Called by EventManager for native paste) ---

  /** Pastes external string data into a single cell */
  public pasteSingleValueExternal(
    targetCell: CellCoords,
    value: string
  ): boolean {
    // Treat external paste as text, only allow pasting into text cells for simplicity
    // Could be enhanced to try parsing based on target cell type
    if (targetCell.row === null || targetCell.col === null) return false;
    const targetSchema = this.stateManager.getSchemaForColumn(targetCell.col);
    if (targetSchema?.type !== "text") {
      log(
        "log",
        this.options.verbose,
        `Clipboard paste cancelled: Target cell ${targetCell.row},${targetCell.col} is not type 'text'.`
      );
      return false;
    }
    // Use the existing single value paste logic, forcing type 'text'
    return this._pasteSingleValue(targetCell, value, "text");
  }

  /** Pastes external 2D string array starting from a single top-left cell */
  public pasteRangeFromTopLeftExternal(
    startCell: CellCoords,
    rangeData: string[][]
  ): boolean {
    // Similar to _pasteRangeFromTopLeft, but assumes string data and checks target type
    if (
      startCell.row === null ||
      startCell.col === null ||
      !rangeData ||
      rangeData.length === 0
    ) {
      return false;
    }
    const startRow = startCell.row;
    const startCol = startCell.col;
    const numRowsToPaste = rangeData.length;
    const numColsToPaste = rangeData[0]?.length || 0;
    let changed = false;
    const totalRows = this.stateManager.dataLength;
    const totalCols = this.stateManager.getColumns().length;
    const affectedRows: number[] = [];
    const affectedColumns = new Set<string>();

    for (let rOffset = 0; rOffset < numRowsToPaste; rOffset++) {
      const targetRow = startRow + rOffset;
      if (targetRow >= totalRows) break;

      const pastedRowData = rangeData[rOffset];
      let rowChanged = false;

      for (let cOffset = 0; cOffset < numColsToPaste; cOffset++) {
        const targetCol = startCol + cOffset;
        if (targetCol >= totalCols) break;

        const valueToPaste = pastedRowData[cOffset]; // Already a string
        const targetColKey = this.stateManager.getColumnKey(targetCol);
        const targetSchema = this.stateManager.getSchemaForColumn(targetCol);

        if (this.stateManager.isCellDisabled(targetRow, targetCol)) continue;

        // Only allow pasting string into text cells
        if (targetSchema?.type !== "text") {
          log(
            "log",
            this.options.verbose,
            `Clipboard paste range: Target cell ${targetRow},${targetCol} is not type 'text'. Skipping.`
          );
          continue;
        }

        const currentValue = this.stateManager.getCellData(
          targetRow,
          targetCol
        );
        const validationResult = validateInput(
          valueToPaste,
          targetSchema,
          targetColKey,
          this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
          this.options.verbose,
          this.stateManager.getData(true),
          targetRow
        );
        if ("error" in validationResult) {
          log("warn", this.options.verbose, validationResult.error);
          if (validationResult.errorType === "required" && !currentValue) {
            this.stateManager.updateCell(
              targetRow,
              `${ERROR_FIELD_PREFIX}${targetColKey}`,
              validationResult.error
            );
          } else {
            this.renderer.setTemporaryErrors([
              { row: targetRow, col: targetCol, error: validationResult.error },
            ]);
          }
          changed = true;
          // TODO: add to affectedRows and affectedColumns
          continue;
        } else {
          this.stateManager.removeCellValue(
            targetRow,
            `${ERROR_FIELD_PREFIX}${targetColKey}`
          );
        }

        if (currentValue !== valueToPaste) {
          this.stateManager.updateCellInternal(
            targetRow,
            targetCol,
            valueToPaste
          );
          rowChanged = true;
          affectedColumns.add(targetColKey);
        }
      }

      if (rowChanged) {
        affectedRows.push(targetRow);
        changed = true;
      }
    }

    if (affectedRows.length > 0) {
      this._batchUpdateCellsAndNotify(
        affectedRows,
        Array.from(affectedColumns)
      );
      log(
        "log",
        this.options.verbose,
        `Pasted external range [${numRowsToPaste}x${numColsToPaste}] starting at ${startRow},${startCol}`
      );
    }

    return changed;
  }

  /** Pastes external 2D string array into a selected range (repeating pattern) */
  public pasteRangeToRangeExternal(
    targetRange: { start: CellCoords; end: CellCoords },
    sourceRangeData: string[][]
  ): boolean {
    // Similar to _pasteRangeToRange, but assumes string data and checks target type
    if (!sourceRangeData || sourceRangeData.length === 0) return false;
    const sourceRows = sourceRangeData.length;
    const sourceCols = sourceRangeData[0]?.length || 0;
    if (sourceCols === 0) return false;

    let changed = false;
    const affectedRows: number[] = [];
    const affectedColumns = new Set<string>();

    for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
      let rowChanged = false;
      for (
        let col = targetRange.start.col!;
        col <= targetRange.end.col!;
        col++
      ) {
        const sourceRowIndex = (row - targetRange.start.row!) % sourceRows;
        const sourceColIndex = (col - targetRange.start.col!) % sourceCols;
        const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex]; // String from clipboard

        const targetColKey = this.stateManager.getColumnKey(col);
        const targetSchema = this.stateManager.getSchemaForColumn(col);

        if (this.stateManager.isCellDisabled(row, col)) continue;

        // Convert based on target cell type
        const convertedValue = this._convertValueForTargetType(
          valueToPaste,
          targetColKey,
          targetSchema
        );
        if (convertedValue === null) continue; // Skip if conversion not possible

        const currentValue = this.stateManager.getCellData(row, col);
        const validationResult = validateInput(
          convertedValue,
          targetSchema,
          targetColKey,
          this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey),
          this.options.verbose,
          this.stateManager.getData(true),
          row
        );
        if ("error" in validationResult) {
          log("warn", this.options.verbose, validationResult.error);
          if (validationResult.errorType === "required" && !currentValue) {
            this.stateManager.updateCell(
              row,
              `${ERROR_FIELD_PREFIX}${targetColKey}`,
              validationResult.error
            );
          } else {
            this.renderer.setTemporaryErrors([
              { row, col, error: validationResult.error },
            ]);
          }
          changed = true;
          // TODO: add to affectedRows and affectedColumns
          continue;
        } else {
          this.stateManager.removeCellValue(
            row,
            `${ERROR_FIELD_PREFIX}${targetColKey}`
          );
        }

        if (currentValue !== convertedValue) {
          this.stateManager.updateCellInternal(row, col, convertedValue);
          rowChanged = true;
          affectedColumns.add(targetColKey);
        }
      }
      if (rowChanged) {
        affectedRows.push(row);
        changed = true;
      }
    }

    if (affectedRows.length > 0) {
      this._batchUpdateCellsAndNotify(
        affectedRows,
        Array.from(affectedColumns)
      );
      log(
        "log",
        this.options.verbose,
        `Pasted external range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`
      );
    }
    return changed;
  }

  /**
   * Handle external paste to entire column
   * @param columnIndex The index of the column to paste to
   * @param value The string value from clipboard
   * @returns true if any cell was changed
   */
  public pasteToColumnExternal(columnIndex: number, value: string): boolean {
    log(
      "log",
      this.options.verbose,
      `External paste to entire column ${columnIndex}`
    );
    const schemaColumn = this.stateManager.getSchemaForColumn(columnIndex);
    const dataLength = this.stateManager.dataLength;
    let changedAny = false;

    if (value === undefined || value === null) {
      log("log", this.options.verbose, "No value to paste to column");
      return false;
    }
    const colKey = this.stateManager.getColumnKey(columnIndex);
    // Convert value to correct type for the column
    const convertedValue = this._convertValueForTargetType(
      value,
      colKey,
      schemaColumn
    );
    // Apply to all cells in the column
    const affectedRows: number[] = [];
    for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
      // Skip disabled cells
      if (this.stateManager.isCellDisabled(rowIndex, columnIndex)) continue;

      const currentValue = this.stateManager.getCellData(rowIndex, columnIndex);
      if (currentValue !== convertedValue) {
        this.stateManager.updateCellInternal(
          rowIndex,
          columnIndex,
          convertedValue
        );
        changedAny = true;
        affectedRows.push(rowIndex);
      }
    }

    // Update disabled states after all changes
    if (changedAny) {
      this._batchUpdateCellsAndNotify(affectedRows, [colKey]);
      this.renderer.draw();
    }

    return changedAny;
  }
}
