// src/dimension-calculator.ts

import { RequiredSpreadsheetOptions } from './types';
import { StateManager } from './state-manager';
import { log } from './utils';

export class DimensionCalculator {
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;

    constructor(options: RequiredSpreadsheetOptions, stateManager: StateManager) {
        this.options = options;
        this.stateManager = stateManager;
    }

    public initializeSizes(rowCount: number): void {
        const columnWidths = this.stateManager.getColumns().map(() => this.options.defaultColumnWidth);
        const rowHeights = Array(rowCount).fill(this.options.defaultRowHeight);
        this.stateManager.setColumnWidths(columnWidths);
        this.stateManager.setRowHeights(rowHeights);
        console.log("Initialized column widths:", columnWidths);
        console.log("Initialized row heights:", rowHeights);
        log('log', this.options.verbose, "Initialized column widths:", columnWidths);
        log('log', this.options.verbose, "Initialized row heights:", rowHeights);
        this.calculateTotalSize();
    }

    public calculateDimensions(viewportWidth: number, viewportHeight: number): void {
        this.stateManager.updateViewportSize(viewportWidth, viewportHeight);
        this.calculateTotalSize(); // Ensure total size is up-to-date
        log('log', this.options.verbose, "Calculated Dimensions:", {
            totalContentWidth: this.stateManager.getTotalContentWidth(),
            totalContentHeight: this.stateManager.getTotalContentHeight(),
            viewportWidth: this.stateManager.getViewportWidth(),
            viewportHeight: this.stateManager.getViewportHeight(),
        });
        this.calculateVisibleRange();
    }

    public calculateTotalSize(): void {
        let totalWidth = this.options.rowNumberWidth;
        this.stateManager.getColumnWidths().forEach(width => totalWidth += width);

        let totalHeight = this.options.headerHeight;
        this.stateManager.getRowHeights().forEach(height => totalHeight += height);

        this.stateManager.updateTotalContentSize(totalWidth, totalHeight);
    }

    public calculateVisibleRange(): void {
        const { headerHeight, rowNumberWidth } = this.options;
        const data = this.stateManager.getData();
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
            const colWidth = columnWidths[col];
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
        let visibleRowEnd = data.length - 1;
        for (let row = 0; row < data.length; row++) {
            const rowHeight = rowHeights[row];
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

        this.stateManager.updateVisibleRange(visibleRowStart, visibleRowEnd, visibleColStart, visibleColEnd);

        log('log', this.options.verbose, "Calculated Visible Range:", {
            rows: `${visibleRowStart} - ${visibleRowEnd}`,
            cols: `${visibleColStart} - ${visibleColEnd}`,
        });
    }

    // --- Getters for position/size needed by other modules ---

    public getColumnLeft(colIndex: number): number {
        let left = this.options.rowNumberWidth;
        const columnWidths = this.stateManager.getColumnWidths();
        for (let i = 0; i < colIndex; i++) {
            left += columnWidths[i];
        }
        return left;
    }

    public getRowTop(rowIndex: number): number {
        let top = this.options.headerHeight;
        const rowHeights = this.stateManager.getRowHeights();
        for (let i = 0; i < rowIndex; i++) {
            top += rowHeights[i];
        }
        return top;
    }
} 