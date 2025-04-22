import { RequiredSpreadsheetOptions } from './types';
import { StateManager } from './state-manager';
import { log } from './utils';
import { DomManager } from 'dom-manager';

export class DimensionCalculator {
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;
    private domManager: DomManager;

    constructor(options: RequiredSpreadsheetOptions, stateManager: StateManager, domManager: DomManager) {
        this.options = options;
        this.stateManager = stateManager;
        this.domManager = domManager;
    }

    public initializeSizes(rowCount: number): void {
        const columnWidths = this.stateManager.getColumns().map(() => this.options.defaultColumnWidth);
        // we will not set default row heights here, because only the updated row heights will be stored in the StateManager
        this.stateManager.setColumnWidths(columnWidths);
        log('log', this.options.verbose, "Initialized column widths:", columnWidths);
        this.calculateTotalSize();
    }

    public calculateDimensions(viewportWidth: number, viewportHeight: number): void {
        const systemScrollbarWidth = this.domManager.getSystemScrollbarWidth();
        this.stateManager.updateViewportSize(viewportWidth - systemScrollbarWidth, viewportHeight - systemScrollbarWidth);
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

        const totalHeight = this.options.headerHeight + this.stateManager.getTotalRowHeight();

        this.stateManager.updateTotalContentSize(totalWidth, totalHeight);
    }

    public calculateVisibleRange(): void {
        const { headerHeight, rowNumberWidth, defaultRowHeight } = this.options;
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
        let top = this.options.headerHeight + (rowIndex * this.options.defaultRowHeight);
        // Use direct access for better performance when calculating row positions
        const rowHeights = this.stateManager.getRowHeights().entries();
        for (const [index, height] of rowHeights) {
            if (index < rowIndex) {
                top += height - this.options.defaultRowHeight;
            }
        }
        return top;
    }
} 