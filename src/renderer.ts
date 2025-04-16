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

        this.ctx.translate(-this.stateManager.getScrollLeft(), -this.stateManager.getScrollTop());
        
        this._drawHeaders();
        this._drawRowNumbers();
        this._drawCells();
        this._drawGridLines();
        this._drawCopiedCellHighlight();
        this._drawActiveCellHighlight();
        this._drawSelectedColumnHighlight();
        this._drawSelectedRowsHighlight();
        this._drawDragRange();

        // // Draw the corner box fixed relative to the viewport
        this._drawCornerBox();
        this.ctx.restore();
    }

    private _clearCanvas(): void {
        this.ctx.fillStyle = "#ffffff"; // Assuming white background
        this.ctx.fillRect(
            0, // No need to use scrollLeft, canvas is translated in draw()
            0, // No need to use scrollTop, canvas is translated in draw()
            this.stateManager.getViewportWidth(),
            this.stateManager.getViewportHeight()
        );
    }

    private _drawCornerBox(): void {
        const { rowNumberWidth, headerHeight, gridLineColor, rowNumberBgColor } = this.options;
        // Draw fixed relative to viewport - after ctx.restore() so no translation is in effect
        // No need for scroll position adjustment here
        const x = 0;
        const y = 0;

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
            headerClipText,
            headerTextAlign,
            padding
        } = this.options;
        const columns = this.stateManager.getColumns();
        const schema = this.stateManager.getSchema();
        const columnWidths = this.stateManager.getColumnWidths();
        const visibleColStart = this.stateManager.getVisibleColStartIndex();
        const visibleColEnd = this.stateManager.getVisibleColEndIndex();
        const width = this.stateManager.getTotalContentWidth();
        const selectedColumn = this.stateManager.getSelectedColumn();
        this.ctx.save();

        // Clip drawing to the visible header area (canvas is already translated)
        const headerVisibleX = rowNumberWidth; // Content area start X
        const headerVisibleY = 0;
        const headerVisibleWidth = width; // Full viewport width
        const headerVisibleHeight = headerHeight;

        this.ctx.beginPath();
        this.ctx.rect(
            headerVisibleX, // No need to add scrollLeft, already handled by global translate
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
            width - rowNumberWidth,
            headerHeight
        );

        // Draw Header Text and Vertical Lines
        this.ctx.font = headerFont;
        this.ctx.textAlign = headerTextAlign;
        this.ctx.textBaseline = "middle";
        

        let currentX = this.dimensionCalculator.getColumnLeft(visibleColStart);

        for (let col = visibleColStart; col <= visibleColEnd; col++) {
            if (col < 0 || col >= columns.length) continue; // Should not happen with correct visible range

            const colKey = columns[col];
            const schemaCol = schema[colKey];
            const headerText = schemaCol?.label || colKey;
            const colWidth = columnWidths[col];
            const isColumnSelected = selectedColumn === col;

            let customBgColor:string|null = null;
            // Highlight selected column headers or if custom column
            if (isColumnSelected) {
                customBgColor = this.options.selectedHeaderBgColor; // Reuse the same color as selected row numbers
            } else if (colKey.startsWith('custom:')) {
                customBgColor = this.options.customHeaderBgColor;
            }
            if(customBgColor) {
                this.ctx.fillStyle = customBgColor;
                this.ctx.fillRect(currentX, 0, colWidth, headerHeight);
            }

            // Draw text centered in the column
            this.ctx.fillStyle = isColumnSelected ? this.options.selectedHeaderTextColor : headerTextColor;
            let textX = currentX + padding;
            if(headerTextAlign === 'center') {
                textX = currentX + colWidth / 2;
            } else if(headerTextAlign === 'right') {
                textX = currentX + colWidth - padding;
            }
            if(!headerClipText) {
                this.ctx.fillText(
                    headerText,
                    textX,
                    headerHeight / 2,
                    colWidth - padding * 2 // Max width to prevent text overflow
                );
            } else {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.rect(currentX, 0, colWidth, headerHeight);
                this.ctx.clip();
                this.ctx.fillText(
                    headerText,
                    textX,
                    headerHeight / 2
                );
                this.ctx.restore();
            }

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
        this.ctx.moveTo(rowNumberWidth, lineY);
        this.ctx.lineTo(this.stateManager.getTotalContentWidth(), lineY);
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
        const totalContentHeight = this.stateManager.getTotalContentHeight();
        this.ctx.save();

        // Clip drawing to the visible row number area
        const rowNumVisibleX = 0;
        const rowNumVisibleY = headerHeight; // Below header
        const rowNumVisibleWidth = rowNumberWidth;
        const rowNumVisibleHeight = totalContentHeight; // Full viewport height

        this.ctx.beginPath();
        this.ctx.rect(
            rowNumVisibleX, // No horizontal scroll for row numbers
            rowNumVisibleY, // No need to add scrollTop, already handled by global translate
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
            totalContentHeight - headerHeight
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
        this.ctx.moveTo(lineX, headerHeight);
        this.ctx.lineTo(lineX, this.stateManager.getViewportHeight());
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
            cellBgColor,
            activeCellBgColor,
            selectedRowBgColor,
            selectedRangeBgColor,
            disabledCellBgColor,
            disabledCellTextColor
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
        const selectedColumn = this.stateManager.getSelectedColumn();
        const activeCell = this.stateManager.getActiveCell();
        const selectionRange = this.stateManager.getNormalizedSelectionRange();
        const scrollLeft = this.stateManager.getScrollLeft();
        const scrollTop = this.stateManager.getScrollTop();

        this.ctx.save();

        // Clip drawing to the visible data area
        const clipX = Math.max(0, rowNumberWidth - scrollLeft);
        const clipY = Math.max(0, headerHeight - scrollTop);
        const clipWidth = this.stateManager.getTotalContentWidth() - clipX;
        const clipHeight = this.stateManager.getTotalContentHeight() - clipY;
        this.ctx.beginPath();
        this.ctx.rect(clipX + scrollLeft, clipY + scrollTop, clipWidth, clipHeight);
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
                const isColumnSelected = selectedColumn === col;

                // Check if the current cell is within the selection range
                const isInSelectionRange = selectionRange &&
                    row >= selectionRange.start.row! && row <= selectionRange.end.row! &&
                    col >= selectionRange.start.col! && col <= selectionRange.end.col!;

                // Determine cell background color - Order matters!
                let currentCellBg = cellBgColor; // 1. Default
                if (isRowSelected) { // 2. Row selection overrides default
                    currentCellBg = selectedRowBgColor;
                }
                if (isColumnSelected) { // 3. Column selection overrides row selection
                    currentCellBg = selectedRowBgColor; // Reuse row selection color for consistency
                }
                if (isInSelectionRange && !isActive) { // 4. Range selection overrides row/column/default (but not active)
                    currentCellBg = selectedRangeBgColor;
                }
                if (isDisabled) { // 5. Disabled overrides everything except active cell
                    currentCellBg = disabledCellBgColor;
                }
                if (isActive && !isEditing) { // 6. Active cell overrides everything (if not editing)
                    currentCellBg = activeCellBgColor;
                }

                // Fill background if not editing
                if (!isEditing && currentCellBg) {
                    this.ctx.fillStyle = currentCellBg;
                    this.ctx.fillRect(currentX, currentY, colWidth, rowHeight);
                }

                // Cell Text (Skip if editing)
                if (!isEditing) {
                    const value = data[row]?.[colKey];
                    const formattedValue = formatValue(value, schemaCol?.type, schemaCol?.values);
                    if (formattedValue !== null && formattedValue !== undefined && formattedValue !== '') {
                        this.ctx.fillStyle = isDisabled ? disabledCellTextColor : textColor;
                        let textX = currentX + padding;
                        if (textAlign === 'center') {
                            textX = currentX + colWidth / 2;
                        } else if (textAlign === 'right') {
                            textX = currentX + colWidth - padding;
                        }
                        const textY = currentY + rowHeight / 2;
                        // do not apply maxWidth to fillText
                        this.ctx.fillText(formattedValue, textX, textY);
                        // this.wrapText(formattedValue, textX, textY, colWidth - padding * 2);
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
                this.ctx.lineTo(lineX, totalHeight); // Draw full logical height
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
        for (let row = 0; row <= data.length; row++) {
            const lineY = Math.round(currentY) - 0.5; // Align to pixel grid
            // Check if the line is within the visible vertical range
            // Since the canvas is translated, compare against viewport origin (0) and height
            if (lineY >= headerHeight && lineY <= viewportHeight + scrollTop) {
                this.ctx.beginPath();
                this.ctx.moveTo(rowNumberWidth, lineY); // Start right of row numbers
                this.ctx.lineTo(totalWidth, lineY); // Draw full logical width
                this.ctx.stroke();
            }
            if (row < data.length) {
                currentY += rowHeights[row];
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

        const { highlightBorderColor, fillHandleColor, fillHandleSize } = this.options;
        this.ctx.save();
        this.ctx.strokeStyle = highlightBorderColor;
        this.ctx.lineWidth = 2;

        let primaryHighlightBounds: CellBounds | null = null;
        let activeCellBounds: CellBounds | null = null;

        if (selectionRange) {
            // Draw border around the entire selection range
            const startBounds = this.getCellBounds(selectionRange.start.row!, selectionRange.start.col!);
            const endBounds = this.getCellBounds(selectionRange.end.row!, selectionRange.end.col!);

            if (startBounds && endBounds) {
                primaryHighlightBounds = {
                    x: startBounds.x,
                    y: startBounds.y,
                    width: (endBounds.x + endBounds.width) - startBounds.x,
                    height: (endBounds.y + endBounds.height) - startBounds.y,
                };
            }
            // Also need the specific active cell bounds for the fill handle
            if (activeCell && activeCell.row !== null && activeCell.col !== null) {
                activeCellBounds = this.getCellBounds(activeCell.row, activeCell.col);
            }
        } else if (activeCell && activeCell.row !== null && activeCell.col !== null) {
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
            const handleCenterX = activeCellBounds.x + activeCellBounds.width - handleRadius - 1;
            const handleCenterY = activeCellBounds.y + activeCellBounds.height - handleRadius - 1;

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
        const copiedRange = this.stateManager.getCopiedSourceRange(); // Use source range for drawing

        if (!copiedCell && !copiedRange) return; // Nothing is copied

        const { copyHighlightBorderColor, copyHighlightBorderDash } = this.options;

        let highlightBounds: CellBounds | null = null;

        if (copiedRange) {
            // Highlight copied range
            const startBounds = this.getCellBounds(copiedRange.start.row!, copiedRange.start.col!); 
            const endBounds = this.getCellBounds(copiedRange.end.row!, copiedRange.end.col!);     
            if (startBounds && endBounds) {
                highlightBounds = {
                    x: startBounds.x,
                    y: startBounds.y,
                    width: (endBounds.x + endBounds.width) - startBounds.x,
                    height: (endBounds.y + endBounds.height) - startBounds.y,
                };
            }
        } else if (copiedCell && copiedCell.row !== null && copiedCell.col !== null) {
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
        const { highlightBorderColor } = this.options;
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
            1,
            columnWidth - 2,
            totalContentHeight - 2
        );
        
        this.ctx.restore();
    }

    private _drawSelectedRowsHighlight(): void {
        const selectedRows = this.stateManager.getSelectedRows();
        if (selectedRows.size === 0) return;
        const { highlightBorderColor } = this.options;
        const totalContentWidth = this.stateManager.getTotalContentWidth();
        const rowHeights = this.stateManager.getRowHeights();

        this.ctx.save();
        this.ctx.strokeStyle = highlightBorderColor;
        this.ctx.lineWidth = 2;

        for (const row of selectedRows) {
            const rowHeight = rowHeights[row];
            const rowY = this.dimensionCalculator.getRowTop(row);

            this.ctx.strokeRect(0, rowY, totalContentWidth, rowHeight);
        }

        this.ctx.restore();
    }

    // TODO: Implement proper text wrapping
    /*private wrapText(text: string, x: number, y: number, maxWidth: number, lineHeight: number = 16) {
        if (!text) return;
        // The following is the text wrapping logic, but it's not fully implemented
        // TODO: align text vertically depending on the height of the cell and its own height
        if (this.ctx.measureText(text).width <= maxWidth) {
            this.ctx.fillText(text, x, y);
            return;
        }
        let words = text.split(/[ \n]/);
        let currentLine = '';
        let testLine = '';
        let metrics;
        let currentY = y;

        for (let i = 0; i < words.length; i++) {
            let word = words[i];
            // Add space only if currentLine is not empty
            testLine = currentLine ? currentLine + ' ' + word : word;

            // Measure the width of the potential line
            metrics = this.ctx.measureText(testLine);
            let testWidth = metrics.width;

            // If the potential line fits or it's the only word and still too long
            if (testWidth <= maxWidth || !currentLine) {
                 currentLine = testLine;
            } else {
                // Draw the previous line that fit
                this.ctx.fillText(currentLine, x, currentY);
                // Start new line with the current word
                currentLine = word;
                // Move to the next line
                currentY += lineHeight;
            }
        }
        // Draw the last line of the current paragraph
        if (currentLine.trim().length) {
            this.ctx.fillText(currentLine, x, currentY);
        }
    }*/

    // --- Helper to get cell bounds in VIEWPORT coordinates --- HINT HINT
    public getCellBounds(rowIndex: number, colIndex: number): CellBounds | null {
        const data = this.stateManager.getData();
        const columns = this.stateManager.getColumns();
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();
        const totalContentWidth = this.stateManager.getTotalContentWidth();
        const totalContentHeight = this.stateManager.getTotalContentHeight();

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

        // Since the canvas is already translated in the draw method, 
        // we use content coordinates directly
        const viewportX = contentX;
        const viewportY = contentY;

        // Check if the cell is at least partially visible within the viewport boundaries
        const isPotentiallyVisible = (
            viewportX < totalContentWidth && // Left edge is before viewport right edge
            viewportX + cellWidth > 0 && // Right edge is after viewport left edge
            viewportY < totalContentHeight && // Top edge is before viewport bottom edge
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