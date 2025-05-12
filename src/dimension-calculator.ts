import { RequiredSpreadsheetOptions } from "./types";
import { StateManager } from "./state-manager";
import { formatValue, log } from "./utils";
import { DomManager } from "dom-manager";

export class DimensionCalculator {
  private options: RequiredSpreadsheetOptions;
  private stateManager: StateManager;
  private domManager: DomManager;
  private canvasContext: CanvasRenderingContext2D | null = null;

  constructor(
    options: RequiredSpreadsheetOptions,
    stateManager: StateManager,
    domManager: DomManager
  ) {
    this.options = options;
    this.stateManager = stateManager;
    this.domManager = domManager;
  }

  public setCanvasContext(ctx: CanvasRenderingContext2D): void {
    this.canvasContext = ctx;
  }

  public calculateDimensions(
    viewportWidth: number,
    viewportHeight: number
  ): void {
    const systemScrollbarWidth = this.domManager.getSystemScrollbarWidth();
    this.stateManager.updateViewportSize(
      viewportWidth - systemScrollbarWidth,
      viewportHeight - systemScrollbarWidth
    );
    this.calculateTotalSize(); // Ensure total size is up-to-date
    log("log", this.options.verbose, "Calculated Dimensions:", {
      totalContentWidth: this.stateManager.getTotalContentWidth(),
      totalContentHeight: this.stateManager.getTotalContentHeight(),
      viewportWidth: this.stateManager.getViewportWidth(),
      viewportHeight: this.stateManager.getViewportHeight(),
    });
    this.calculateVisibleRange();
  }

  public calculateTotalSize(): void {
    const totalWidth = this.stateManager.getTotalColumnWidth();
    const totalHeight = this.stateManager.getTotalRowHeight();
    this.stateManager.updateTotalContentSize(totalWidth, totalHeight);
  }

  /**
   * Automatically resize row heights based on cell content
   * @param colIndex Optional column index to only resize rows based on that specific column
   */
  public autoResizeRowHeights(): void {
    if (!this.options.autoResizeRowHeight || !this.canvasContext) {
      return;
    }

    const { wrapText, padding, defaultRowHeight, defaultColumnWidth } =
      this.options;
    const dataLength = this.stateManager.dataLength;
    const columns = this.stateManager.getColumns();
    const schema = this.stateManager.getSchema();
    const columnWidths = this.stateManager.getColumnWidths();
    const userResizedRows = this.stateManager.getUserResizedRows();

    // Save current canvas context state
    this.canvasContext.save();
    this.canvasContext.font = this.options.font;

    // Process each row
    for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
      // Skip user-resized rows
      if (userResizedRows.has(rowIndex)) {
        continue;
      }
      const currentRowHeight = this.stateManager.getRowHeight(rowIndex);
      // this target column is the one that is currently being resized
      const currentMinRowHeight = defaultRowHeight;

      let maxRowHeight = defaultRowHeight;
      const rowData = this.stateManager.getRowData(rowIndex);
      if (!rowData) continue;

      // Check cells in the row to determine the required height
      for (let col = 0; col < columns.length; col++) {
        // Skip invalid column indexes
        if (col < 0 || col >= columns.length) continue;

        const colKey = columns[col];
        const schemaCol = schema[colKey];

        // Only consider multiline cells or cells that should wrap
        if (!schemaCol?.wordWrap && !wrapText) {
          continue;
        }

        const cellValue = this.stateManager.getCellData(rowIndex, col);
        if (cellValue === null || cellValue === undefined || cellValue === "") {
          continue;
        }

        // Get formatted text value for this cell
        let textValue = String(cellValue);
        if (schemaCol.formatter) {
          const formatted = schemaCol.formatter(cellValue);
          if (formatted !== null && formatted !== undefined) {
            textValue = String(formatted);
          }
        } else {
          textValue = formatValue(
            cellValue,
            schemaCol?.type,
            this.stateManager.cachedDropdownOptionsByColumn.get(colKey)
          );
        }

        // Measure text height for this cell
        const colWidth = columnWidths.get(col) || defaultColumnWidth;
        const contentWidth = colWidth - padding * 2; // available width for text
        const textHeight = this.measureTextHeight(
          textValue,
          contentWidth,
          schemaCol.wordWrap || wrapText
        );

        // Update max height if this cell requires more height
        maxRowHeight = Math.max(maxRowHeight, textHeight + padding * 2);
      }

      // Constrain to min/max limits
      maxRowHeight = Math.max(maxRowHeight, currentMinRowHeight);

      // Only update if different from current height
      if (maxRowHeight !== currentRowHeight) {
        // Update the row height without marking as user-resized
        this.stateManager.setAutoRowHeight(rowIndex, maxRowHeight);
      }
    }

    // Restore canvas context
    this.canvasContext.restore();

    // Recalculate totals after changing heights
    this.calculateTotalSize();
    this.calculateVisibleRange();
  }

  /**
   * Measures the height required to render the given text within the specified width
   */
  private measureTextHeight(
    text: string,
    maxWidth: number,
    shouldWrap: boolean
  ): number {
    if (!this.canvasContext) return this.options.defaultRowHeight;

    const { lineHeight } = this.options;

    // If we don't need to wrap, just return single line height
    if (!shouldWrap) {
      return lineHeight;
    }

    // For wrapped text, we need to calculate how many lines it will take
    const words = text.split(" ");
    let lines = 1;
    let currentLine = "";

    // If multiline input, count explicit newlines
    if (text.includes("\n")) {
      lines = text.split("\n").length;

      // For each line, check if it needs further wrapping
      const textLines = text.split("\n");
      let totalWrappedLines = 0;

      for (const line of textLines) {
        if (!line) {
          totalWrappedLines += 1; // Empty line
          continue;
        }

        const lineWords = line.split(" ");
        let currentTestLine = "";
        let lineWrappedLines = 1;

        for (const word of lineWords) {
          const testLine = currentTestLine
            ? `${currentTestLine} ${word}`
            : word;
          const metrics = this.canvasContext.measureText(testLine);

          if (metrics.width <= maxWidth) {
            currentTestLine = testLine;
          } else {
            currentTestLine = word;
            lineWrappedLines++;
          }
        }

        totalWrappedLines += lineWrappedLines;
      }

      lines = totalWrappedLines;
    } else {
      // No explicit newlines, just word wrapping
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = this.canvasContext.measureText(testLine);

        if (metrics.width <= maxWidth) {
          currentLine = testLine;
        } else {
          currentLine = word;
          lines++;
        }
      }
    }

    return lines * lineHeight;
  }

  public calculateVisibleRange(): void {
    const {
      headerHeight,
      rowNumberWidth,
      defaultRowHeight,
      defaultColumnWidth,
    } = this.options;
    const dataLength = this.stateManager.dataLength;
    const columns = this.stateManager.getColumns();
    const columnWidths = this.stateManager.getColumnWidths();
    const rowHeights = this.stateManager.getRowHeights();
    const scrollLeft = this.stateManager.getScrollLeft();
    const scrollTop = this.stateManager.getScrollTop();
    const viewportWidth = this.stateManager.getViewportWidth();
    const viewportHeight = this.stateManager.getViewportHeight();

    // Calculate Visible Columns
    let currentX = rowNumberWidth;
    let visibleColStart = -1;
    let visibleColEnd = columns.length - 1;
    for (let col = 0; col < columns.length; col++) {
      const colWidth = columnWidths.get(col) || defaultColumnWidth;
      const colRight = currentX + colWidth;
      if (colRight > scrollLeft && currentX < scrollLeft + viewportWidth) {
        if (visibleColStart === -1) {
          visibleColStart = col;
        }
        visibleColEnd = col;
      } else if (visibleColStart !== -1) {
        // Optimization: once we pass the visible range, no need to check further
        break;
      }
      currentX = colRight;
    }
    if (visibleColStart === -1) {
      visibleColStart = 0;
      visibleColEnd = -1; // Indicates no columns are visible
    }

    // Calculate Visible Rows
    let currentY = headerHeight;
    let visibleRowStart = -1;
    let visibleRowEnd = dataLength - 1;
    for (let row = 0; row < dataLength; row++) {
      const rowHeight = rowHeights.get(row) || defaultRowHeight;
      const rowBottom = currentY + rowHeight;
      if (rowBottom > scrollTop && currentY < scrollTop + viewportHeight) {
        if (visibleRowStart === -1) {
          visibleRowStart = row;
        }
        visibleRowEnd = row;
      } else if (visibleRowStart !== -1) {
        // Optimization
        break;
      }
      currentY = rowBottom;
    }
    if (visibleRowStart === -1) {
      visibleRowStart = 0;
      visibleRowEnd = -1; // Indicates no rows are visible
    }

    this.stateManager.updateVisibleRange(
      visibleRowStart,
      visibleRowEnd,
      visibleColStart,
      visibleColEnd
    );

    log("log", this.options.verbose, "Calculated Visible Range:", {
      rows: `${visibleRowStart} - ${visibleRowEnd}`,
      cols: `${visibleColStart} - ${visibleColEnd}`,
    });
  }

  // --- Getters for position/size needed by other modules ---

  public getColumnLeft(colIndex: number): number {
    const { rowNumberWidth, defaultColumnWidth } = this.options;
    let left = rowNumberWidth + colIndex * defaultColumnWidth;
    // Use direct access for better performance when calculating row positions
    const columnWidths = this.stateManager.getColumnWidths().entries();
    for (const [index, width] of columnWidths) {
      if (index < colIndex) {
        left += width - defaultColumnWidth;
      }
    }
    return left;
  }

  public getRowTop(rowIndex: number): number {
    const { headerHeight, defaultRowHeight } = this.options;
    let top = headerHeight + rowIndex * defaultRowHeight;
    // Use direct access for better performance when calculating row positions
    const rowHeights = this.stateManager.getRowHeights().entries();
    for (const [index, height] of rowHeights) {
      if (index < rowIndex) {
        top += height - defaultRowHeight;
      }
    }
    return top;
  }
}
