import { RequiredSpreadsheetOptions, CellBounds } from "./types";
import { StateManager } from "./state-manager";
import { DimensionCalculator } from "./dimension-calculator";
import { formatValue } from "./utils";
import { LOADING_FIELD_PREFIX, ERROR_FIELD_PREFIX } from "./config";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private options: RequiredSpreadsheetOptions;
  private stateManager: StateManager;
  private dimensionCalculator: DimensionCalculator;
  private temporaryErrors: Map<string, { error?: string; expireAt: number }> =
    new Map();

  constructor(
    ctx: CanvasRenderingContext2D,
    options: RequiredSpreadsheetOptions,
    stateManager: StateManager,
    dimensionCalculator: DimensionCalculator
  ) {
    this.ctx = ctx;
    this.options = options;
    this.stateManager = stateManager;
    this.dimensionCalculator = dimensionCalculator;
  }

  /**
   * Sets a temporary error indicator for a cell
   * @param row Row index
   * @param col Column index
   */
  public setTemporaryErrors(
    cells: { row: number; col: number; error?: string }[]
  ): void {
    const { temporaryErrorTimeout } = this.options;
    // temporary error animation is disabled if timeout is not set
    if (!temporaryErrorTimeout) return;

    const keys: [string, string | undefined][] = cells.map(
      ({ row, col, error }) => [`${row}:${col}`, error]
    );
    const expireAt = Date.now() + temporaryErrorTimeout;

    // Add to temporary errors map
    for (const [key, error] of keys) {
      this.temporaryErrors.set(key, { error, expireAt });
    }

    // Set timeout to clear the error
    setTimeout(() => {
      let clearCount = 0;
      for (const [key] of keys) {
        clearCount += this.temporaryErrors.delete(key) ? 1 : 0;
      }
      if (clearCount) {
        this.draw(); // Redraw to update display
      }
    }, temporaryErrorTimeout);
  }
  /**
   * Clears temporary errors for the given cells
   * @param cells - An array of objects with row and col properties
   * @returns true if any errors were cleared, false otherwise
   */
  public clearTemporaryErrors(cells: { row: number; col: number }[]): boolean {
    let clearCount = 0;
    for (const { row, col } of cells) {
      clearCount += this.temporaryErrors.delete(`${row}:${col}`) ? 1 : 0;
    }
    return clearCount > 0;
  }

  public draw(): void {
    this.ctx.save();
    this.ctx.font = this.options.font;
    this._clearCanvas();

    // Clean up expired temporary errors before drawing
    this._cleanupExpiredErrors();

    // Draw the fixed parts first (without translation)
    this._drawCornerBox(); // Fixed corner
    this._drawHeaders(); // Fixed headers on top
    this._drawRowNumbers(); // Fixed row numbers on left

    // Now apply translation for scrollable content area only
    this.ctx.save();
    this.ctx.beginPath();
    // Create a clipping region for the scrollable content area
    const { headerHeight, rowNumberWidth } = this.options;
    this.ctx.rect(
      rowNumberWidth,
      headerHeight,
      this.stateManager.getViewportWidth() - rowNumberWidth,
      this.stateManager.getViewportHeight() - headerHeight
    );
    this.ctx.clip();

    // Apply scroll translation only for the content area
    this.ctx.translate(
      -this.stateManager.getScrollLeft(),
      -this.stateManager.getScrollTop()
    );

    // Draw the scrollable content
    this._drawCells();
    this._drawGridLines();
    this._drawCopiedCellHighlight();
    this._drawActiveCellHighlight();
    this._drawSelectedColumnHighlight();
    this._drawSelectedRowsHighlight();
    this._drawDragRange();

    this.ctx.restore(); // Restore from clip/translation
    this.ctx.restore(); // Restore from first save
  }

  private _cleanupExpiredErrors(): void {
    const now = Date.now();
    for (const [key, { expireAt }] of this.temporaryErrors.entries()) {
      if (now >= expireAt) {
        this.temporaryErrors.delete(key);
      }
    }
  }

  private _clearCanvas(): void {
    this.ctx.fillStyle = "#ffffff"; // Assuming white background
    this.ctx.fillRect(
      0,
      0,
      this.stateManager.getViewportWidth(),
      this.stateManager.getViewportHeight()
    );
  }

  private _drawCornerBox(): void {
    const { rowNumberWidth, headerHeight, gridLineColor, rowNumberBgColor } =
      this.options;
    // Draw fixed relative to viewport - after ctx.restore() so no translation is in effect
    // No need for scroll position adjustment here
    const x = 0;
    const y = 0;

    this.ctx.save();
    this.ctx.fillStyle = rowNumberBgColor;
    this.ctx.fillRect(x, y, rowNumberWidth, headerHeight);
    this.ctx.strokeStyle = gridLineColor;
    // top and left border not needed
    this.ctx.strokeRect(x - 0.5, y - 0.5, rowNumberWidth, headerHeight);
    this.ctx.restore();
  }

  private _drawHeaders(): void {
    const {
      headerHeight,
      rowNumberWidth,
      headerFont,
      headerBgColor,
      headerTextColor,
      gridLineColor,
      headerClipText,
      headerTextAlign,
      padding,
      selectedHeaderBgColor,
      customHeaderBgColor,
      readonlyHeaderBgColor,
      selectedHeaderTextColor,
      readonlyHeaderTextColor,
      highlightBorderColor,
    } = this.options;
    const columns = this.stateManager.getColumns();
    const schema = this.stateManager.getSchema();
    const columnWidths = this.stateManager.getColumnWidths();
    const selectedColumn = this.stateManager.getSelectedColumn();
    // Get scroll position for header horizontal scrolling
    const scrollLeft = this.stateManager.getScrollLeft();

    this.ctx.save();

    // Clip drawing to the visible header area (fixed vertical position)
    const headerVisibleX = rowNumberWidth; // Start after row numbers
    const headerVisibleY = 0;
    const headerVisibleWidth =
      this.stateManager.getViewportWidth() - rowNumberWidth;
    const headerVisibleHeight = headerHeight;

    this.ctx.beginPath();
    this.ctx.rect(
      headerVisibleX,
      headerVisibleY,
      headerVisibleWidth,
      headerVisibleHeight
    );
    this.ctx.clip();

    // Apply horizontal scroll for headers (but not vertical)
    this.ctx.translate(-scrollLeft, 0);

    // Background for the entire logical header width
    this.ctx.fillStyle = headerBgColor;
    this.ctx.fillRect(
      rowNumberWidth,
      0,
      this.stateManager.getTotalContentWidth(),
      headerHeight
    );

    // Draw Header Text and Vertical Lines
    this.ctx.font = headerFont;
    this.ctx.textAlign = headerTextAlign;
    this.ctx.textBaseline = "middle";

    // Calculate which columns are visible
    let currentX = rowNumberWidth;

    for (let col = 0; col < columns.length; col++) {
      const colWidth = columnWidths[col];

      // Skip if column is completely out of view
      if (currentX + colWidth < scrollLeft + rowNumberWidth) {
        currentX += colWidth;
        continue;
      }

      // Break if column is beyond right edge of viewport
      if (currentX > scrollLeft + this.stateManager.getViewportWidth()) {
        break;
      }

      const colKey = columns[col];
      const schemaCol = schema[colKey];
      const headerText = schemaCol?.label || colKey;
      const isColumnSelected = selectedColumn === col;

      let customBgColor: string | null = null;
      let customTextColor = headerTextColor;
      // Highlight selected column headers or if custom column
      if (isColumnSelected) {
        customBgColor = selectedHeaderBgColor;
        customTextColor = selectedHeaderTextColor;
      } else if (schemaCol?.removable) {
        customBgColor = customHeaderBgColor;
      } else if (schemaCol?.readonly) {
        customBgColor = readonlyHeaderBgColor;
        customTextColor = readonlyHeaderTextColor;
      }
      if (customBgColor) {
        this.ctx.fillStyle = customBgColor;
        this.ctx.fillRect(currentX, 0, colWidth, headerHeight);
      }

      if (isColumnSelected) {
        this.ctx.strokeStyle = highlightBorderColor;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(currentX + 1, 1, colWidth - 2, headerHeight);
      }

      // Draw text centered in the column
      this.ctx.fillStyle = customTextColor;
      let textX = currentX + padding;
      if (headerTextAlign === "center") {
        textX = currentX + colWidth / 2;
      } else if (headerTextAlign === "right") {
        textX = currentX + colWidth - padding;
      }
      if (!headerClipText) {
        this.ctx.fillText(
          headerText,
          textX,
          headerHeight / 2,
          colWidth - padding * 2
        );
      } else {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(currentX, 0, colWidth, headerHeight);
        this.ctx.clip();
        this.ctx.fillText(headerText, textX, headerHeight / 2);
        this.ctx.restore();
      }

      if (!isColumnSelected) {
        // Draw vertical separator line
        this.ctx.strokeStyle = gridLineColor;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        const lineX = Math.round(currentX + colWidth) - 0.5; // Align to pixel grid
        this.ctx.moveTo(lineX, 0);
        this.ctx.lineTo(lineX, headerHeight);
        this.ctx.stroke();
      }

      currentX += colWidth;
    }

    // Draw bottom border of the header row
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.beginPath();
    const lineY = headerHeight - 0.5;
    this.ctx.moveTo(rowNumberWidth, lineY);
    this.ctx.lineTo(
      Math.max(currentX, this.stateManager.getViewportWidth() + scrollLeft),
      lineY
    );
    this.ctx.stroke();

    this.ctx.restore(); // Restore clipping context
  }

  private _drawRowNumbers(): void {
    const {
      headerHeight,
      rowNumberWidth,
      font,
      rowNumberBgColor,
      selectedRowNumberBgColor,
      textColor,
      gridLineColor,
      defaultRowHeight,
      highlightBorderColor,
    } = this.options;
    const dataLength = this.stateManager.dataLength;
    const totalContentHeight = this.stateManager.getTotalContentHeight();
    // Get scroll position for row numbers vertical scrolling
    const scrollTop = this.stateManager.getScrollTop();

    if (dataLength) {
      const rowHeights = this.stateManager.getRowHeights();
      const selectedRows = this.stateManager.getSelectedRows();

      this.ctx.save();

      // Clip drawing to the visible row number area (fixed horizontal position)
      const rowNumVisibleX = 0;
      const rowNumVisibleY = headerHeight;
      const rowNumVisibleWidth = rowNumberWidth;
      const rowNumVisibleHeight =
        this.stateManager.getViewportHeight() - headerHeight;

      this.ctx.beginPath();
      this.ctx.rect(
        rowNumVisibleX,
        rowNumVisibleY,
        rowNumVisibleWidth,
        rowNumVisibleHeight
      );
      this.ctx.clip();

      // Apply vertical scroll for row numbers (but not horizontal)
      this.ctx.translate(0, -scrollTop);

      // Background for the entire logical row number column height
      this.ctx.fillStyle = rowNumberBgColor;
      this.ctx.fillRect(0, headerHeight, rowNumberWidth, totalContentHeight);

      // Draw Row Numbers and Horizontal Lines
      this.ctx.font = font;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";

      // Calculate which rows are visible
      let currentY = headerHeight;

      for (let row = 0; row < dataLength; row++) {
        const rowHeight = rowHeights.get(row) || defaultRowHeight;

        // Skip if row is completely out of view
        if (currentY + rowHeight < scrollTop + headerHeight) {
          currentY += rowHeight;
          continue;
        }

        // Break if row is beyond bottom edge of viewport
        if (currentY > scrollTop + this.stateManager.getViewportHeight()) {
          break;
        }
        const isSelected = selectedRows.has(row);
        // Highlight selected row number background
        if (isSelected) {
          this.ctx.fillStyle = selectedRowNumberBgColor;
          this.ctx.fillRect(0, currentY, rowNumberWidth, rowHeight);

          // stroke the row number
          this.ctx.strokeStyle = highlightBorderColor;
          this.ctx.lineWidth = 2;
          this.ctx.strokeRect(0, currentY, rowNumberWidth, rowHeight);
        }

        // Draw row number text
        this.ctx.fillStyle = textColor;
        this.ctx.fillText(
          (row + 1).toString(),
          rowNumberWidth / 2,
          currentY + rowHeight / 2
        );

        if (!isSelected) {
          // Draw horizontal separator line
          this.ctx.strokeStyle = gridLineColor;
          this.ctx.beginPath();
          this.ctx.lineWidth = 1;
          const lineY = Math.round(currentY + rowHeight) - 0.5;
          this.ctx.moveTo(0, lineY);
          this.ctx.lineTo(rowNumberWidth, lineY);
          this.ctx.stroke();
        }

        currentY += rowHeight;
      }

      // Draw right border of the row number column
      this.ctx.strokeStyle = gridLineColor;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      const lineX = rowNumberWidth - 0.5;
      this.ctx.moveTo(lineX, headerHeight);
      this.ctx.lineTo(
        lineX,
        Math.max(currentY, this.stateManager.getViewportHeight() + scrollTop)
      );
      this.ctx.stroke();

      this.ctx.restore(); // Restore clipping context
    }
  }

  private _drawCells(): void {
    const {
      headerHeight,
      rowNumberWidth,
      font,
      textColor,
      textAlign,
      padding,
      cellBgColor,
      activeCellBgColor,
      selectedRowBgColor,
      selectedRangeBgColor,
      disabledCellBgColor,
      disabledCellTextColor,
      errorCellBgColor,
      errorTextColor,
      loadingTextColor,
      placeholderTextColor,
      defaultRowHeight,
      wrapText,
      lineHeight,
    } = this.options;
    const dataLength = this.stateManager.dataLength;
    const columns = this.stateManager.getColumns();
    const schema = this.stateManager.getSchema();
    const rowHeights = this.stateManager.getRowHeights();
    const columnWidths = this.stateManager.getColumnWidths();
    const visibleRowStart = this.stateManager.getVisibleRowStartIndex();
    const visibleRowEnd = this.stateManager.getVisibleRowEndIndex();
    const visibleColStart = this.stateManager.getVisibleColStartIndex();
    const visibleColEnd = this.stateManager.getVisibleColEndIndex();
    const selectedRows = this.stateManager.getSelectedRows();
    const selectedColumn = this.stateManager.getSelectedColumn();
    const activeCell = this.stateManager.getActiveCell();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();
    const scrollLeft = this.stateManager.getScrollLeft();
    const scrollTop = this.stateManager.getScrollTop();
    const viewportWidth = this.stateManager.getViewportWidth();
    const viewportHeight = this.stateManager.getViewportHeight();

    this.ctx.save();

    // Clip drawing to the visible data area
    const clipX = Math.max(0, rowNumberWidth - scrollLeft);
    const clipY = Math.max(0, headerHeight - scrollTop);
    const clipWidth = viewportWidth - clipX;
    const clipHeight = viewportHeight - clipY;
    this.ctx.beginPath();
    this.ctx.rect(clipX + scrollLeft, clipY + scrollTop, clipWidth, clipHeight);
    this.ctx.clip();

    // Set base text properties
    this.ctx.font = font;
    this.ctx.textAlign = textAlign as CanvasTextAlign;
    this.ctx.textBaseline = "middle";

    let currentY = this.dimensionCalculator.getRowTop(visibleRowStart);

    for (let row = visibleRowStart; row <= visibleRowEnd; row++) {
      if (row < 0 || row >= dataLength) continue;
      const data = this.stateManager.getRowData(row);
      const rowHeight = rowHeights.get(row) || defaultRowHeight;
      const isRowSelected = selectedRows.has(row);
      let currentX = this.dimensionCalculator.getColumnLeft(visibleColStart);

      for (let col = visibleColStart; col <= visibleColEnd; col++) {
        if (col < 0 || col >= columns.length) continue;

        const colWidth = columnWidths[col];
        const colKey = columns[col];
        const schemaCol = schema[colKey];
        const canRenderCellDuringEdit = ["select", "boolean", "date"].includes(
          schemaCol?.type
        );
        const currentCellError = data?.[`${ERROR_FIELD_PREFIX}${colKey}`];
        const isDisabled = this.stateManager.isCellDisabled(row, col);
        const isActive = activeCell?.row === row && activeCell?.col === col;
        const isEditing =
          this.stateManager.getActiveEditor()?.row === row &&
          this.stateManager.getActiveEditor()?.col === col;
        const isColumnSelected = selectedColumn === col;
        const isCellLoading = data?.[`${LOADING_FIELD_PREFIX}${colKey}`];

        // Check if this cell has a temporary error
        const temporaryError = this.temporaryErrors.get(`${row}:${col}`)?.error;

        // Check if the current cell is within the selection range
        const isInSelectionRange =
          selectionRange &&
          row >= selectionRange.start.row! &&
          row <= selectionRange.end.row! &&
          col >= selectionRange.start.col! &&
          col <= selectionRange.end.col!;

        // Determine cell background color - Order matters!
        let currentCellBg = cellBgColor; // 1. Default
        if (isRowSelected) {
          // 2. Row selection overrides default
          currentCellBg = selectedRowBgColor;
        }
        if (isColumnSelected) {
          // 3. Column selection overrides row selection
          currentCellBg = selectedRowBgColor; // Reuse row selection color for consistency
        }
        if (isInSelectionRange && !isActive) {
          // 4. Range selection overrides row/column/default (but not active)
          currentCellBg = selectedRangeBgColor;
        }
        if (isDisabled) {
          // 5. Disabled overrides everything except active cell
          currentCellBg = disabledCellBgColor;
        }
        if (isActive && !isEditing) {
          // 6. Active cell overrides everything (if not editing)
          currentCellBg = activeCellBgColor;
        }
        if (currentCellError || temporaryError) {
          // 7. Error overrides everything
          currentCellBg = errorCellBgColor;
        }

        // Fill background if not editing
        if ((!isEditing || canRenderCellDuringEdit) && currentCellBg) {
          this.ctx.fillStyle = currentCellBg;
          this.ctx.fillRect(currentX, currentY, colWidth, rowHeight);
        }

        // Cell Text (Skip if editing)
        let showRenderText = true;
        if (isEditing && !canRenderCellDuringEdit) {
          showRenderText = false;
        }

        if (showRenderText) {
          const textY = currentY + rowHeight / 2;
          let textX = currentX + padding;
          if (isCellLoading) {
            this.ctx.fillStyle = loadingTextColor;
            this.ctx.fillText(
              "(Loading...)",
              textX,
              textY,
              colWidth - padding * 2
            );
          } else {
            const value = data?.[colKey];
            let formattedValue = temporaryError
              ? temporaryError
              : schemaCol?.formatter
              ? schemaCol.formatter(value)
              : formatValue(
                  value,
                  schemaCol?.type,
                  this.stateManager.cachedDropdownOptionsByColumn.get(colKey)
                );
            if (!formattedValue && currentCellError) {
              formattedValue = `${currentCellError}`.includes("required")
                ? "(required)"
                : currentCellError;
            }
            if (
              formattedValue !== null &&
              formattedValue !== undefined &&
              formattedValue !== ""
            ) {
              // Apply error text color for both permanent and temporary errors
              this.ctx.fillStyle = isDisabled
                ? disabledCellTextColor
                : isEditing
                ? placeholderTextColor
                : currentCellError || temporaryError
                ? errorTextColor
                : textColor;

              if (textAlign === "center") {
                textX = currentX + colWidth / 2;
              } else if (textAlign === "right") {
                textX = currentX + colWidth - padding;
              }
              // do not apply maxWidth to fillText
              if (!schemaCol.multiline && !wrapText) {
                // optimize basic text rendering
                this.ctx.fillText(formattedValue, textX, textY);
              } else {
                this.wrapText(
                  formattedValue,
                  textX,
                  currentY,
                  colWidth - padding * 2,
                  rowHeight,
                  wrapText,
                  lineHeight
                );
              }
            }
          }
        }

        currentX += colWidth;
      }
      currentY += rowHeight;
    }
    this.ctx.restore();
  }

  private _drawGridLines(): void {
    const { headerHeight, rowNumberWidth, gridLineColor, defaultRowHeight } =
      this.options;
    const totalWidth = this.stateManager.getTotalContentWidth();
    const totalHeight = this.stateManager.getTotalContentHeight();
    const columns = this.stateManager.getColumns();
    const dataLength = this.stateManager.dataLength;
    const columnWidths = this.stateManager.getColumnWidths();
    const rowHeights = this.stateManager.getRowHeights();
    const viewportWidth = this.stateManager.getViewportWidth();
    const viewportHeight = this.stateManager.getViewportHeight();

    // For visibility checks, we still need the scroll positions
    const scrollLeft = this.stateManager.getScrollLeft();
    const scrollTop = this.stateManager.getScrollTop();

    this.ctx.save();
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.lineWidth = 1;

    // Vertical lines
    let currentX = rowNumberWidth;
    for (let col = 0; col <= columns.length; col++) {
      const lineX = Math.round(currentX) - 0.5; // Align to pixel grid
      // Check if the line is within the visible horizontal range
      // Since the canvas is translated, compare against viewport origin (0) and width
      if (lineX >= rowNumberWidth && lineX <= viewportWidth + scrollLeft) {
        this.ctx.beginPath();
        this.ctx.moveTo(lineX, headerHeight); // Start below header
        this.ctx.lineTo(lineX, totalHeight + headerHeight); // Draw full logical height
        this.ctx.stroke();
      }
      if (col < columns.length) {
        currentX += columnWidths[col];
      }
      // Optimization: Stop drawing if we've passed the right edge of the viewport
      if (currentX > viewportWidth + scrollLeft) break;
    }

    // Horizontal lines
    let currentY = headerHeight;
    for (let row = 0; row <= dataLength; row++) {
      const lineY = Math.round(currentY) - 0.5; // Align to pixel grid
      // Check if the line is within the visible vertical range
      // Since the canvas is translated, compare against viewport origin (0) and height
      if (lineY >= headerHeight && lineY <= viewportHeight + scrollTop) {
        this.ctx.beginPath();
        this.ctx.moveTo(rowNumberWidth, lineY); // Start right of row numbers
        this.ctx.lineTo(totalWidth + rowNumberWidth, lineY); // Draw full logical width
        this.ctx.stroke();
      }
      if (row < dataLength) {
        currentY += rowHeights.get(row) || defaultRowHeight;
      }
      // Optimization: Stop drawing if we've passed the bottom edge of the viewport
      if (currentY > viewportHeight + scrollTop) break;
    }

    this.ctx.restore();
  }

  private _drawActiveCellHighlight(): void {
    const activeCell = this.stateManager.getActiveCell();
    const isDraggingFill = this.stateManager.isDraggingFillHandle();
    const isResizing = this.stateManager.isResizing();
    const activeEditor = this.stateManager.getActiveEditor();
    const selectionRange = this.stateManager.getNormalizedSelectionRange();

    // Don't draw highlight if resizing, or if dragging fill handle
    if (isResizing || isDraggingFill) return;
    // Need an active cell OR a selection range to draw anything
    if (!activeCell && !selectionRange) return;

    const { highlightBorderColor, fillHandleColor, fillHandleSize } =
      this.options;
    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor;
    this.ctx.lineWidth = 2;

    let primaryHighlightBounds: CellBounds | null = null;
    let activeCellBounds: CellBounds | null = null;

    if (selectionRange) {
      // Draw border around the entire selection range
      const startBounds = this.getCellBounds(
        selectionRange.start.row!,
        selectionRange.start.col!
      );
      const endBounds = this.getCellBounds(
        selectionRange.end.row!,
        selectionRange.end.col!
      );

      if (startBounds && endBounds) {
        primaryHighlightBounds = {
          x: startBounds.x,
          y: startBounds.y,
          width: endBounds.x + endBounds.width - startBounds.x,
          height: endBounds.y + endBounds.height - startBounds.y,
        };
      }
      // Also need the specific active cell bounds for the fill handle
      if (activeCell && activeCell.row !== null && activeCell.col !== null) {
        activeCellBounds = this.getCellBounds(activeCell.row, activeCell.col);
      }
    } else if (
      activeCell &&
      activeCell.row !== null &&
      activeCell.col !== null
    ) {
      // Single cell selection - highlight is just the active cell
      activeCellBounds = this.getCellBounds(activeCell.row, activeCell.col);
      primaryHighlightBounds = activeCellBounds;
    }

    // Draw the main highlight border
    if (primaryHighlightBounds) {
      this.ctx.strokeRect(
        primaryHighlightBounds.x + 1, // Offset slightly for inside border
        primaryHighlightBounds.y + 1,
        primaryHighlightBounds.width - 2,
        primaryHighlightBounds.height - 2
      );
    }

    // Draw fill handle (always relates to the active cell, even in range selection)
    // Only draw if not editing and the active cell is visible
    if (!activeEditor && activeCellBounds) {
      const handleRadius = fillHandleSize / 2;
      const handleCenterX =
        activeCellBounds.x + activeCellBounds.width - handleRadius - 1;
      const handleCenterY =
        activeCellBounds.y + activeCellBounds.height - handleRadius - 1;

      this.ctx.fillStyle = fillHandleColor;
      this.ctx.beginPath();
      this.ctx.arc(handleCenterX, handleCenterY, handleRadius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = "#ffffff"; // White border for handle
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private _drawDragRange(): void {
    const isDragging = this.stateManager.isDraggingFillHandle();
    const dragStartCell = this.stateManager.getDragStartCell();
    const dragEndRow = this.stateManager.getDragEndRow();

    if (
      !isDragging ||
      !dragStartCell ||
      dragEndRow === null ||
      dragEndRow === dragStartCell.row
    )
      return;
    const { row: startRow, col: startCol } = dragStartCell;
    if (startRow === null || startCol === null) return;

    const { dragRangeBorderColor, defaultRowHeight } = this.options;
    const endRow = dragEndRow;
    const columnWidths = this.stateManager.getColumnWidths();
    const rowHeights = this.stateManager.getRowHeights();
    const dataLength = this.stateManager.dataLength;

    // Ensure startCol is valid
    if (startCol < 0 || startCol >= columnWidths.length) return;

    const startColWidth = columnWidths[startCol];
    const startColX = this.dimensionCalculator.getColumnLeft(startCol);

    // Determine if we're dragging down or up
    const isDraggingDown = endRow >= startRow;

    let dragStartY, dragRangeHeight;

    if (isDraggingDown) {
      // Dragging downward - start from bottom of start cell
      const startRowY = this.dimensionCalculator.getRowTop(startRow);
      dragStartY = startRowY + (rowHeights.get(startRow) || defaultRowHeight);

      // Calculate height from rows after start row to end row (inclusive)
      dragRangeHeight = 0;
      for (let r = startRow + 1; r <= endRow; r++) {
        if (r >= dataLength) break;
        dragRangeHeight += rowHeights.get(r) || defaultRowHeight;
      }
    } else {
      // Dragging upward - start from top of end row
      dragStartY = this.dimensionCalculator.getRowTop(endRow);

      // Calculate height from end row to the row before start row (inclusive)
      dragRangeHeight = 0;
      for (let r = endRow; r < startRow; r++) {
        if (r >= dataLength) break;
        dragRangeHeight += rowHeights.get(r) || defaultRowHeight;
      }
    }

    if (dragRangeHeight <= 0) return; // No actual range to draw

    // Convert content coordinates to viewport coordinates
    const viewportX = startColX;
    const viewportY = dragStartY;

    this.ctx.save();
    this.ctx.strokeStyle = dragRangeBorderColor;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([4, 2]); // Dashed line

    // Draw the rectangle relative to the translated context
    this.ctx.strokeRect(
      viewportX + 0.5, // Offset by 0.5 for sharp lines
      viewportY + 0.5,
      startColWidth - 1, // Adjust width/height to stay within lines
      dragRangeHeight - 1
    );

    this.ctx.restore();
  }

  private _drawCopiedCellHighlight(): void {
    const copiedCell = this.stateManager.getCopiedCell();
    const copiedRange = this.stateManager.getCopiedSourceRange(); // Use source range for drawing

    if (!copiedCell && !copiedRange) return; // Nothing is copied

    const { copyHighlightBorderColor, copyHighlightBorderDash } = this.options;

    let highlightBounds: CellBounds | null = null;

    if (copiedRange) {
      // Highlight copied range
      const startBounds = this.getCellBounds(
        copiedRange.start.row!,
        copiedRange.start.col!
      );
      const endBounds = this.getCellBounds(
        copiedRange.end.row!,
        copiedRange.end.col!
      );
      if (startBounds && endBounds) {
        highlightBounds = {
          x: startBounds.x,
          y: startBounds.y,
          width: endBounds.x + endBounds.width - startBounds.x,
          height: endBounds.y + endBounds.height - startBounds.y,
        };
      }
    } else if (
      copiedCell &&
      copiedCell.row !== null &&
      copiedCell.col !== null
    ) {
      // Highlight single copied cell
      highlightBounds = this.getCellBounds(copiedCell.row, copiedCell.col);
    }

    if (!highlightBounds) return; // Bounds not visible or invalid

    this.ctx.save();
    this.ctx.strokeStyle = copyHighlightBorderColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash(copyHighlightBorderDash);

    // Draw dashed border slightly inside bounds for better alignment
    this.ctx.strokeRect(
      highlightBounds.x + 0.5,
      highlightBounds.y + 0.5,
      highlightBounds.width - 1,
      highlightBounds.height - 1
    );

    this.ctx.restore();
  }

  private _drawSelectedColumnHighlight(): void {
    const selectedColumn = this.stateManager.getSelectedColumn();
    if (selectedColumn === null) return; // Only draw when exactly one column is selected
    const { highlightBorderColor, headerHeight } = this.options;
    const totalContentHeight = this.stateManager.getTotalContentHeight();
    const columnWidths = this.stateManager.getColumnWidths();

    // Get column position and width
    const columnLeft = this.dimensionCalculator.getColumnLeft(selectedColumn);
    const columnWidth = columnWidths[selectedColumn];

    if (!columnWidth) return;

    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor; // Blue border color
    this.ctx.lineWidth = 2;

    // Draw border around the entire column
    this.ctx.strokeRect(
      columnLeft + 1,
      headerHeight - 1,
      columnWidth - 2,
      totalContentHeight
    );

    this.ctx.restore();
  }

  private _drawSelectedRowsHighlight(): void {
    const selectedRows = this.stateManager.getSelectedRows();
    if (selectedRows.size === 0) return;
    const { highlightBorderColor, defaultRowHeight, rowNumberWidth } =
      this.options;
    const totalContentWidth = this.stateManager.getTotalContentWidth();
    const rowHeights = this.stateManager.getRowHeights();

    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor;
    this.ctx.lineWidth = 2;

    for (const row of selectedRows) {
      const rowHeight = rowHeights.get(row) || defaultRowHeight;
      const rowY = this.dimensionCalculator.getRowTop(row);

      this.ctx.strokeRect(
        rowNumberWidth - 1,
        rowY,
        totalContentWidth,
        rowHeight
      );
    }

    this.ctx.restore();
  }

  /**
   * Wraps text and draws it within a specified bounding box.
   * Default vertical alignment is middle. If the text's total height
   * exceeds maxHeight, alignment switches to top.
   * Optimizes by skipping draw calls for lines entirely outside vertical bounds.
   *
   * @param text The text string to wrap.
   * @param x The x coordinate for the left edge of the text lines.
   * @param top The y coordinate for the top edge of the bounding box.
   * @param maxWidth The maximum width for text lines.
   * @param maxHeight The maximum height for the bounding box.
   * @param lineHeight The desired height for each line of text (default 16).
   */
  private wrapText(
    text: string,
    x: number,
    top: number,
    maxWidth: number,
    maxHeight: number,
    wrap: boolean,
    lineHeight: number
  ) {
    // Ensure context exists and text is provided
    if (!this.ctx || !text) return;
    // Ensure positive dimensions to avoid issues
    if (maxWidth <= 0 || maxHeight <= 0) return;

    // --- 1. Setup and Calculate Lines ---
    const originalBaseline = this.ctx.textBaseline;
    this.ctx.textBaseline = "middle";
    let lines: string[] = [];

    if (wrap) {
      // --- Logic for when wrap is TRUE (existing logic) ---
      let words = text.split(/[ \n]/); // Split by space OR newline
      let currentLine = "";
      for (let i = 0; i < words.length; i++) {
        let word = words[i];
        if (!word) continue; // Skip empty strings resulting from multiple spaces/newlines

        let testLine = currentLine ? currentLine + " " + word : word;
        let metrics = this.ctx.measureText(testLine);

        if (metrics.width <= maxWidth || !currentLine) {
          // Word fits or it's the first word on the line
          currentLine = testLine;
        } else {
          // Word doesn't fit, push the current line and start a new one with the word
          // Check if the single word itself is too long (optional, but good practice)
          const wordWidth = this.ctx.measureText(word).width;
          if (!currentLine && wordWidth > maxWidth) {
            // Handle very long word that exceeds maxWidth on its own
            lines.push(word); // Add the long word as its own line (will be clipped)
            currentLine = ""; // Reset current line
          } else {
            // Push the completed line
            lines.push(currentLine);
            // Start new line with the current word
            currentLine = word;
            // Check again if this new word *alone* exceeds width (edge case for next iteration)
            if (this.ctx.measureText(currentLine).width > maxWidth) {
              lines.push(currentLine);
              currentLine = "";
            }
          }
        }
      }
      // Add the last remaining line
      if (currentLine) {
        lines.push(currentLine);
      }
    } else {
      // --- Logic for when wrap is FALSE ---
      // Split *only* by explicit newline characters
      lines = text.split("\n");
      // No further width-based wrapping needed. Each element in 'lines' is a line.
    }

    // --- 2. Determine Vertical Alignment & Starting Y ---
    const numLines = lines.length;
    const totalHeight = numLines * lineHeight;
    let startY: number;
    if (totalHeight <= maxHeight) {
      // Center vertically if it fits
      const boxCenterY = top + maxHeight / 2;
      startY = boxCenterY - totalHeight / 2 + lineHeight / 2; // Adjust for middle baseline
    } else {
      // Align to top if it overflows
      startY = top + lineHeight / 2; // Adjust for middle baseline
    }

    // --- 3. Draw the Text with Clipping and Optimization ---
    this.ctx.save();
    this.ctx.beginPath();
    // Apply clipping based on the cell bounds
    this.ctx.rect(x, top, maxWidth, maxHeight);
    this.ctx.clip();

    const lineTopEdgeMargin = lineHeight / 2; // Approx distance from baseline to top
    const lineBottomEdgeMargin = lineHeight / 2; // Approx distance from baseline to bottom
    const boundaryBottom = top + maxHeight;

    for (let i = 0; i < numLines; i++) {
      const lineY = startY + i * lineHeight; // Middle baseline Y of the current line

      // OPTIMIZATION: Check if line is entirely outside the vertical bounds
      if (lineY + lineBottomEdgeMargin < top) {
        // Entirely above
        continue;
      }
      if (lineY - lineTopEdgeMargin > boundaryBottom) {
        // Entirely below
        break; // No need to check further lines
      }

      // If we passed the checks, the line is at least partially visible.
      // Draw the text - the clipping region handles exact boundaries.
      this.ctx.fillText(lines[i], x, lineY); // Draw the line (might exceed maxWidth if wrap=false)
    }

    this.ctx.restore(); // Remove clipping region

    // Restore original baseline if necessary
    if (this.ctx.textBaseline !== originalBaseline) {
      this.ctx.textBaseline = originalBaseline;
    }
  }

  // --- Helper to get cell bounds in VIEWPORT coordinates ---
  public getCellBounds(rowIndex: number, colIndex: number): CellBounds | null {
    const { headerHeight, rowNumberWidth } = this.options;
    const dataLength = this.stateManager.dataLength;
    const columns = this.stateManager.getColumns();
    const columnWidths = this.stateManager.getColumnWidths();
    const totalContentWidth =
      this.stateManager.getTotalContentWidth() + rowNumberWidth;
    const totalContentHeight =
      this.stateManager.getTotalContentHeight() + headerHeight;

    if (
      rowIndex < 0 ||
      rowIndex >= dataLength ||
      colIndex < 0 ||
      colIndex >= columns.length
    ) {
      return null;
    }

    const cellWidth = columnWidths[colIndex];
    const cellHeight = this.stateManager.getRowHeight(rowIndex);
    const contentX = this.dimensionCalculator.getColumnLeft(colIndex);
    const contentY = this.dimensionCalculator.getRowTop(rowIndex);

    // Since the canvas is already translated in the draw method,
    // we use content coordinates directly
    const viewportX = contentX;
    const viewportY = contentY;

    // Check if the cell is at least partially visible within the viewport boundaries
    const isPotentiallyVisible =
      viewportX < totalContentWidth && // Left edge is before viewport right edge
      viewportX + cellWidth > 0 && // Right edge is after viewport left edge
      viewportY < totalContentHeight && // Top edge is before viewport bottom edge
      viewportY + cellHeight > 0; // Bottom edge is after viewport top edge

    if (!isPotentiallyVisible) {
      return null;
    }

    // Return bounds in viewport coordinates
    return { x: viewportX, y: viewportY, width: cellWidth, height: cellHeight };
  }

  // --- Helper to get fill handle bounds in VIEWPORT coordinates ---
  public getFillHandleBounds(
    rowIndex: number,
    colIndex: number
  ): CellBounds | null {
    const cellBounds = this.getCellBounds(rowIndex, colIndex);
    if (!cellBounds) return null;
    const { fillHandleSize, headerHeight, rowNumberWidth } = this.options;
    const handleRadius = fillHandleSize / 2;

    // Calculate center based on viewport coordinates from getCellBounds
    const handleCenterX = cellBounds.x + cellBounds.width - handleRadius - 1; // Slightly inside
    const handleCenterY = cellBounds.y + cellBounds.height - handleRadius - 1;

    // Return bounds centered around the calculated center point
    // also subtract the fixed rowNumberWidth and headerHeight
    return {
      x: handleCenterX - handleRadius - rowNumberWidth,
      y: handleCenterY - handleRadius - headerHeight,
      width: fillHandleSize,
      height: fillHandleSize,
    };
  }
}
