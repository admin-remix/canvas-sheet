// src/renderer.ts

import {
    RequiredSpreadsheetOptions,
    DataRow,
    ColumnSchema,
    CellBounds,
    CellCoords
} from './types';
import { StateManager } from './state-manager';
import { DimensionCalculator } from './dimension-calculator';
import { formatValue } from './utils';
import { DISABLED_FIELD_PREFIX } from './config';

export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;
    private dimensionCalculator: DimensionCalculator;

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

    public draw(): void {
        this.ctx.save();
        this.ctx.font = this.options.font;
        this._clearCanvas();

        // Translate coordinate system for scrolling
        this.ctx.translate(-this.stateManager.getScrollLeft(), -this.stateManager.getScrollTop());

        this._drawHeaders();
        this._drawRowNumbers();
        this._drawCells();
        this._drawGridLines();
        this._drawCopiedCellHighlight();
        this._drawActiveCellHighlight();
        this._drawDragRange();

        this.ctx.restore();

        // Draw the corner box fixed relative to the viewport
        this._drawCornerBox();
    }

    private _clearCanvas(): void {
        this.ctx.fillStyle = "#ffffff"; // Assuming white background
        this.ctx.fillRect(
            this.stateManager.getScrollLeft(),
            this.stateManager.getScrollTop(),
            this.stateManager.getViewportWidth(),
            this.stateManager.getViewportHeight()
        );
    }

    private _drawCornerBox(): void {
        const { rowNumberWidth, headerHeight, gridLineColor, rowNumberBgColor } = this.options;
        // Draw fixed relative to viewport, so use scroll positions
        const x = this.stateManager.getScrollLeft();
        const y = this.stateManager.getScrollTop();

        this.ctx.save();
        this.ctx.fillStyle = rowNumberBgColor;
        this.ctx.fillRect(x, y, rowNumberWidth, headerHeight);
        this.ctx.strokeStyle = gridLineColor;
        // Use integer coordinates for sharp lines
        this.ctx.strokeRect(x + 0.5, y + 0.5, rowNumberWidth, headerHeight);
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
        } = this.options;
        const columns = this.stateManager.getColumns();
        const schema = this.stateManager.getSchema();
        const columnWidths = this.stateManager.getColumnWidths();
        const visibleColStart = this.stateManager.getVisibleColStartIndex();
        const visibleColEnd = this.stateManager.getVisibleColEndIndex();
        const scrollLeft = this.stateManager.getScrollLeft();

        this.ctx.save();

        // Clip drawing to the visible header area (considering scroll)
        const headerVisibleX = rowNumberWidth; // Content area start X
        const headerVisibleY = 0;
        const headerVisibleWidth = this.stateManager.getViewportWidth(); // Full viewport width
        const headerVisibleHeight = headerHeight;

        this.ctx.beginPath();
        this.ctx.rect(
            headerVisibleX + scrollLeft, // Adjust clipping start based on scroll
            headerVisibleY,
            headerVisibleWidth - rowNumberWidth, // Clip width excludes row numbers
            headerVisibleHeight
        );
        this.ctx.clip();

        // Background for the entire logical header width (might extend beyond viewport)
        this.ctx.fillStyle = headerBgColor;
        this.ctx.fillRect(
            rowNumberWidth,
            0,
            this.stateManager.getTotalContentWidth() - rowNumberWidth,
            headerHeight
        );

        // Draw Header Text and Vertical Lines
        this.ctx.font = headerFont;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = headerTextColor;

        let currentX = this.dimensionCalculator.getColumnLeft(visibleColStart);

        for (let col = visibleColStart; col <= visibleColEnd; col++) {
            if (col < 0 || col >= columns.length) continue; // Should not happen with correct visible range

            const colKey = columns[col];
            const schemaCol = schema[colKey];
            const headerText = schemaCol?.label || colKey;
            const colWidth = columnWidths[col];

            // Draw text centered in the column
            this.ctx.fillText(
                headerText,
                currentX + colWidth / 2,
                headerHeight / 2,
                colWidth - 10 // Max width to prevent text overflow
            );

            // Draw vertical separator line
            this.ctx.strokeStyle = gridLineColor;
            this.ctx.beginPath();
            const lineX = Math.round(currentX + colWidth) - 0.5; // Align to pixel grid
            this.ctx.moveTo(lineX, 0);
            this.ctx.lineTo(lineX, headerHeight);
            this.ctx.stroke();

            currentX += colWidth;
        }

        this.ctx.restore(); // Restore clipping context

        // Draw bottom border of the header row
        this.ctx.strokeStyle = gridLineColor;
        this.ctx.beginPath();
        const lineY = headerHeight - 0.5;
        this.ctx.moveTo(rowNumberWidth + scrollLeft, lineY + this.stateManager.getScrollTop());
        this.ctx.lineTo(this.stateManager.getViewportWidth() + scrollLeft, lineY + this.stateManager.getScrollTop());
        this.ctx.stroke();
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
        } = this.options;
        const data = this.stateManager.getData();
        const rowHeights = this.stateManager.getRowHeights();
        const selectedRows = this.stateManager.getSelectedRows();
        const visibleRowStart = this.stateManager.getVisibleRowStartIndex();
        const visibleRowEnd = this.stateManager.getVisibleRowEndIndex();
        const scrollTop = this.stateManager.getScrollTop();

        this.ctx.save();

        // Clip drawing to the visible row number area
        const rowNumVisibleX = 0;
        const rowNumVisibleY = headerHeight; // Below header
        const rowNumVisibleWidth = rowNumberWidth;
        const rowNumVisibleHeight = this.stateManager.getViewportHeight(); // Full viewport height

        this.ctx.beginPath();
        this.ctx.rect(
            rowNumVisibleX, // No horizontal scroll for row numbers
            rowNumVisibleY + scrollTop, // Adjust clipping start based on scroll
            rowNumVisibleWidth,
            rowNumVisibleHeight - headerHeight // Clip height excludes header
        );
        this.ctx.clip();

        // Background for the entire logical row number column height
        this.ctx.fillStyle = rowNumberBgColor;
        this.ctx.fillRect(
            0,
            headerHeight,
            rowNumberWidth,
            this.stateManager.getTotalContentHeight() - headerHeight
        );

        // Draw Row Numbers and Horizontal Lines
        this.ctx.font = font;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        let currentY = this.dimensionCalculator.getRowTop(visibleRowStart);

        for (let row = visibleRowStart; row <= visibleRowEnd; row++) {
            if (row < 0 || row >= data.length) continue;

            const rowHeight = rowHeights[row];

            // Highlight selected row number background
            if (selectedRows.has(row)) {
                this.ctx.fillStyle = selectedRowNumberBgColor;
                this.ctx.fillRect(0, currentY, rowNumberWidth, rowHeight);
            }

            // Draw row number text
            this.ctx.fillStyle = textColor;
            this.ctx.fillText(
                (row + 1).toString(),
                rowNumberWidth / 2,
                currentY + rowHeight / 2
            );

            // Draw horizontal separator line
            this.ctx.strokeStyle = gridLineColor;
            this.ctx.beginPath();
            const lineY = Math.round(currentY + rowHeight) - 0.5;
            this.ctx.moveTo(0, lineY);
            this.ctx.lineTo(rowNumberWidth, lineY);
            this.ctx.stroke();

            currentY += rowHeight;
        }

        this.ctx.restore(); // Restore clipping context

        // Draw right border of the row number column
        this.ctx.strokeStyle = gridLineColor;
        this.ctx.beginPath();
        const lineX = rowNumberWidth - 0.5;
        this.ctx.moveTo(lineX, headerHeight + scrollTop);
        this.ctx.lineTo(lineX, this.stateManager.getViewportHeight() + scrollTop);
        this.ctx.stroke();
    }

    private _drawCells(): void {
        const {
            headerHeight,
            rowNumberWidth,
            font,
            textColor,
            textAlign,
            textBaseline,
            padding,
            cellBgColor,         // Default cell background
            activeCellBgColor,   // Active cell background
            selectedRowBgColor,  // Selected row background
            disabledCellBgColor,
            disabledCellTextColor // Corrected name
        } = this.options;
        const data = this.stateManager.getData();
        const columns = this.stateManager.getColumns();
        const schema = this.stateManager.getSchema();
        const rowHeights = this.stateManager.getRowHeights();
        const columnWidths = this.stateManager.getColumnWidths();
        const visibleRowStart = this.stateManager.getVisibleRowStartIndex();
        const visibleRowEnd = this.stateManager.getVisibleRowEndIndex();
        const visibleColStart = this.stateManager.getVisibleColStartIndex();
        const visibleColEnd = this.stateManager.getVisibleColEndIndex();
        const selectedRows = this.stateManager.getSelectedRows();
        const activeCell = this.stateManager.getActiveCell();

        this.ctx.save();

        // Clip drawing to the visible data area
        const clipX = rowNumberWidth;
        const clipY = headerHeight;
        const clipWidth = this.stateManager.getTotalContentWidth() - rowNumberWidth;
        const clipHeight = this.stateManager.getTotalContentHeight() - headerHeight;
        this.ctx.beginPath();
        this.ctx.rect(clipX, clipY, clipWidth, clipHeight);
        this.ctx.clip();

        // Set base text properties
        this.ctx.font = font;
        this.ctx.textAlign = textAlign as CanvasTextAlign;
        this.ctx.textBaseline = textBaseline as CanvasTextBaseline;

        let currentY = this.dimensionCalculator.getRowTop(visibleRowStart);

        for (let row = visibleRowStart; row <= visibleRowEnd; row++) {
            if (row < 0 || row >= data.length) continue;

            const rowHeight = rowHeights[row];
            const isRowSelected = selectedRows.has(row);
            let currentX = this.dimensionCalculator.getColumnLeft(visibleColStart);

            for (let col = visibleColStart; col <= visibleColEnd; col++) {
                if (col < 0 || col >= columns.length) continue;

                const colWidth = columnWidths[col];
                const colKey = columns[col];
                const schemaCol = schema[colKey];
                const isDisabled = this.stateManager.isCellDisabled(row, col);
                const isActive = activeCell?.row === row && activeCell?.col === col;
                const isEditing = this.stateManager.getActiveEditor()?.row === row && this.stateManager.getActiveEditor()?.col === col;

                // Determine cell background color
                let currentCellBg = cellBgColor; // Start with default
                if (isRowSelected) {
                    currentCellBg = selectedRowBgColor;
                }
                if (isDisabled) {
                    currentCellBg = disabledCellBgColor;
                }
                 if (isActive && !isEditing) {
                    // Active cell highlight takes precedence over row/disabled, but not when editing
                    currentCellBg = activeCellBgColor;
                }

                // Fill background if not editing (editor overlays background)
                if (!isEditing && currentCellBg) {
                    this.ctx.fillStyle = currentCellBg;
                    this.ctx.fillRect(currentX, currentY, colWidth, rowHeight);
                }

                // Cell Text (Skip if editing)
                if (!isEditing) {
                    const value = data[row]?.[colKey];
                    // Correctly call formatValue using schema info (value, type, options)
                    const formattedValue = formatValue(value, schemaCol?.type, schemaCol?.values);
                    if (formattedValue !== null && formattedValue !== undefined && formattedValue !== '') {
                        this.ctx.fillStyle = isDisabled ? disabledCellTextColor : textColor;
                        let textX = currentX + padding;
                        if (textAlign === 'center') {
                            textX = currentX + colWidth / 2;
                        } else if (textAlign === 'right') {
                            textX = currentX + colWidth - padding;
                        }
                        const textY = currentY + rowHeight / 2; // Assumes textBaseline: 'middle'
                        this.ctx.fillText(formattedValue, textX, textY);// clip text to colWidth
                    }
                }

                currentX += colWidth;
            }
            currentY += rowHeight;
        }
        this.ctx.restore();
    }

    private _drawGridLines(): void {
        const { headerHeight, rowNumberWidth, gridLineColor } = this.options;
        const totalWidth = this.stateManager.getTotalContentWidth();
        const totalHeight = this.stateManager.getTotalContentHeight();
        const columns = this.stateManager.getColumns();
        const data = this.stateManager.getData();
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();
        const scrollLeft = this.stateManager.getScrollLeft();
        const scrollTop = this.stateManager.getScrollTop();
        const viewportWidth = this.stateManager.getViewportWidth();
        const viewportHeight = this.stateManager.getViewportHeight();

        this.ctx.save();
        this.ctx.strokeStyle = gridLineColor;
        this.ctx.lineWidth = 1;

        // Vertical lines
        let currentX = rowNumberWidth;
        for (let col = 0; col <= columns.length; col++) {
            const lineX = Math.round(currentX) - 0.5; // Align to pixel grid
            // Check if the line is within the visible horizontal range
            if (lineX >= scrollLeft + rowNumberWidth && lineX <= scrollLeft + viewportWidth) {
                this.ctx.beginPath();
                this.ctx.moveTo(lineX, headerHeight); // Start below header
                this.ctx.lineTo(lineX, totalHeight); // Draw full logical height
                this.ctx.stroke();
            }
            if (col < columns.length) {
                currentX += columnWidths[col];
            }
            // Optimization: Stop drawing if we've passed the right edge of the viewport
            if (currentX > scrollLeft + viewportWidth) break;
        }

        // Horizontal lines
        let currentY = headerHeight;
        for (let row = 0; row <= data.length; row++) {
            const lineY = Math.round(currentY) - 0.5; // Align to pixel grid
            // Check if the line is within the visible vertical range
            if (lineY >= scrollTop + headerHeight && lineY <= scrollTop + viewportHeight) {
                this.ctx.beginPath();
                this.ctx.moveTo(rowNumberWidth, lineY); // Start right of row numbers
                this.ctx.lineTo(totalWidth, lineY); // Draw full logical width
                this.ctx.stroke();
            }
            if (row < data.length) {
                currentY += rowHeights[row];
            }
            // Optimization: Stop drawing if we've passed the bottom edge of the viewport
            if (currentY > scrollTop + viewportHeight) break;
        }

        this.ctx.restore();
    }

    private _drawActiveCellHighlight(): void {
        const activeCell = this.stateManager.getActiveCell();
        const isDragging = this.stateManager.isDraggingFillHandle();
        const isResizing = this.stateManager.isResizing();
        const activeEditor = this.stateManager.getActiveEditor();

        if (!activeCell || isDragging || isResizing) return;

        if (activeCell.row === null || activeCell.col === null) return;
        const bounds = this.getCellBounds(activeCell.row, activeCell.col);
        if (!bounds) return; // Cell is not visible

        const { highlightBorderColor, fillHandleColor, fillHandleSize } = this.options;
        const { x, y, width, height } = bounds;

        this.ctx.save();
        this.ctx.strokeStyle = highlightBorderColor;
        this.ctx.lineWidth = 2;

        // Draw highlight border inside the cell bounds
        this.ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

        // Draw fill handle only if editor is not active
        if (!activeEditor) {
            const handleRadius = fillHandleSize / 2;
            const handleCenterX = x + width - handleRadius - 1; // Position slightly inside
            const handleCenterY = y + height - handleRadius - 1;

            this.ctx.fillStyle = fillHandleColor;
            this.ctx.beginPath();
            this.ctx.arc(handleCenterX, handleCenterY, handleRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // Optional: Add a white border to the handle for better visibility
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    private _drawDragRange(): void {
        const isDragging = this.stateManager.isDraggingFillHandle();
        const dragStartCell = this.stateManager.getDragStartCell();
        const dragEndRow = this.stateManager.getDragEndRow();

        if (!isDragging || !dragStartCell || dragEndRow === null || dragEndRow === dragStartCell.row) return;

        const { dragRangeBorderColor } = this.options;
        const { row: startRow, col: startCol } = dragStartCell;
        if (startRow === null || startCol === null) return;
        const endRow = dragEndRow;
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();

        // Ensure startCol is valid
        if (startCol === null || startCol < 0 || startCol >= columnWidths.length) return;

        const startColWidth = columnWidths[startCol];
        const startColX = this.dimensionCalculator.getColumnLeft(startCol);

        // Calculate the Y position of the bottom of the start cell
        const startRowY = this.dimensionCalculator.getRowTop(startRow);
        const dragStartY = startRowY + (rowHeights[startRow] || this.options.defaultRowHeight);

        // Calculate the total height of the dragged range (from startRow+1 to endRow)
        let dragRangeHeight = 0;
        for (let r = startRow + 1; r <= endRow; r++) {
            if (r >= rowHeights.length) break; // Stop if going beyond data bounds
            dragRangeHeight += rowHeights[r] || this.options.defaultRowHeight;
        }

        if (dragRangeHeight <= 0) return; // No actual range to draw

        // Convert content coordinates to viewport coordinates
        const viewportX = startColX; // No need to subtract scrollLeft here, already done by global translate
        const viewportY = dragStartY;

        this.ctx.save();
        this.ctx.strokeStyle = dragRangeBorderColor;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 2]); // Dashed line

        // Draw the rectangle relative to the translated context
        this.ctx.strokeRect(
            viewportX + 0.5,        // Offset by 0.5 for sharp lines
            viewportY + 0.5,
            startColWidth - 1,      // Adjust width/height to stay within lines
            dragRangeHeight - 1
        );

        this.ctx.restore();
    }

    private _drawCopiedCellHighlight(): void {
        const copiedCell = this.stateManager.getCopiedCell();
        if (!copiedCell) return;

        const { row, col } = copiedCell;
        if (row === null || col === null) return;

        const bounds = this.getCellBounds(row, col);
        if (!bounds) return; // Cell not visible

        const { highlightBorderColor } = this.options;
        const { x, y, width, height } = bounds;

        this.ctx.save();
        this.ctx.strokeStyle = highlightBorderColor;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 2]); // Dashed line for copy highlight

        // Draw dashed border inside the cell bounds
        this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

        this.ctx.restore();
    }

    // --- Helper to get cell bounds in VIEWPORT coordinates --- HINT HINT
    public getCellBounds(rowIndex: number, colIndex: number): CellBounds | null {
        const data = this.stateManager.getData();
        const columns = this.stateManager.getColumns();
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();
        const scrollLeft = this.stateManager.getScrollLeft();
        const scrollTop = this.stateManager.getScrollTop();
        const viewportWidth = this.stateManager.getViewportWidth();
        const viewportHeight = this.stateManager.getViewportHeight();

        if (
            rowIndex < 0 ||
            rowIndex >= data.length ||
            colIndex < 0 ||
            colIndex >= columns.length
        ) {
            return null;
        }

        const cellWidth = columnWidths[colIndex];
        const cellHeight = rowHeights[rowIndex];
        const contentX = this.dimensionCalculator.getColumnLeft(colIndex);
        const contentY = this.dimensionCalculator.getRowTop(rowIndex);

        // Calculate viewport coordinates
        const viewportX = contentX - scrollLeft;
        const viewportY = contentY - scrollTop;

        // Check if the cell is at least partially visible within the viewport boundaries
        const isPotentiallyVisible = (
            viewportX < viewportWidth && // Left edge is before viewport right edge
            viewportX + cellWidth > 0 && // Right edge is after viewport left edge
            viewportY < viewportHeight && // Top edge is before viewport bottom edge
            viewportY + cellHeight > 0    // Bottom edge is after viewport top edge
        );

        if (!isPotentiallyVisible) {
            return null;
        }

        // Return bounds in viewport coordinates
        return { x: viewportX, y: viewportY, width: cellWidth, height: cellHeight };
    }

    // --- Helper to get fill handle bounds in VIEWPORT coordinates ---
    public getFillHandleBounds(rowIndex: number, colIndex: number): CellBounds | null {
        const cellBounds = this.getCellBounds(rowIndex, colIndex);
        if (!cellBounds) return null;

        const { fillHandleSize } = this.options;
        const handleRadius = fillHandleSize / 2;

        // Calculate center based on viewport coordinates from getCellBounds
        const handleCenterX = cellBounds.x + cellBounds.width - handleRadius -1; // Slightly inside
        const handleCenterY = cellBounds.y + cellBounds.height - handleRadius -1;

        // Return bounds centered around the calculated center point
        return {
            x: handleCenterX - handleRadius,
            y: handleCenterY - handleRadius,
            width: fillHandleSize,
            height: fillHandleSize,
        };
    }
} 