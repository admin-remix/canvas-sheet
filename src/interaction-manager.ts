import {
    RequiredSpreadsheetOptions,
    CellCoords,
    DataType,
    ColumnSchema,
    CellUpdateEvent,
    CellBounds
} from './types';
import { StateManager } from './state-manager';
import { Renderer } from './renderer';
import { DimensionCalculator } from './dimension-calculator';
import { log, validateInput } from './utils';
import { DomManager } from './dom-manager';
import { EditingManager } from './editing-manager'; // Needed for moving active cell
import { HistoryManager } from './history-manager';

export class InteractionManager {
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;
    private renderer: Renderer;
    private dimensionCalculator: DimensionCalculator;
    private domManager: DomManager;
    private historyManager: HistoryManager;
    private editingManager!: EditingManager; // Use definite assignment assertion
    private lastPasteHandledAt: Date | null = null;// used to prevent multiple pastes in a row
    private ignoreNextScrollTimeout: number | null = null;
    private _customEventHandler: ((event: Event) => void) | null = null;

    constructor(
        options: RequiredSpreadsheetOptions,
        stateManager: StateManager,
        renderer: Renderer,
        dimensionCalculator: DimensionCalculator,
        domManager: DomManager,
        historyManager: HistoryManager
    ) {
        this.options = options;
        this.stateManager = stateManager;
        this.renderer = renderer;
        this.dimensionCalculator = dimensionCalculator;
        this.domManager = domManager;
        this.historyManager = historyManager;
        // editingManager will be set via setter injection after all managers are created
    }

    public bindCustomEvents(customEventHandler: ((event: Event) => void) | null = null): void {
        this._customEventHandler = customEventHandler;
    }

    public triggerCustomEvent(eventName: "resize"): void {
        this._customEventHandler?.call(this, new CustomEvent(eventName));
    }

    // Setter for circular dependency
    public setEditingManager(editingManager: EditingManager): void {
        this.editingManager = editingManager;
    }

    public canScrollMore(delta: number, vertical: boolean): boolean {
        if (vertical) {
            return delta > 0 ? this.domManager.canVScrollDown() : this.domManager.canVScrollUp();
        } else {
            return delta > 0 ? this.domManager.canHScrollRight() : this.domManager.canHScrollLeft();
        }
    }
    public moveScroll(deltaX: number, deltaY: number, isAbsolute: boolean = false): void {
        const scrollTop = this.domManager.setVScrollPosition(isAbsolute ? deltaY : this.domManager.getVScrollPosition() + deltaY);
        const scrollLeft = this.domManager.setHScrollPosition(isAbsolute ? deltaX : this.domManager.getHScrollPosition() + deltaX);
        this.stateManager.updateScroll(scrollTop, scrollLeft);
    }

    public bringBoundsIntoView(bounds: CellBounds): { scrollLeft: number, scrollTop: number } {
        const scrollLeft = this.domManager.getHScrollPosition();
        const scrollTop = this.domManager.getVScrollPosition();
        const canvasRect = this.domManager.getCanvasBoundingClientRect();
        const boundsX = bounds.x - scrollLeft;
        const boundsY = bounds.y - scrollTop;
        const boundsWidth = bounds.width;
        const boundsHeight = bounds.height;
        let newScrollLeft = scrollLeft;
        let newScrollTop = scrollTop;

        if (boundsX < 0) {
            newScrollLeft += boundsX;
        } else if (boundsX + boundsWidth > canvasRect.width) {
            newScrollLeft += boundsX + boundsWidth - canvasRect.width;
        }

        if (boundsY < 0) {
            newScrollTop += boundsY;
        } else if (boundsY + boundsHeight > canvasRect.height) {
            newScrollTop += boundsY + boundsHeight - canvasRect.height;
        }

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
    public handleRowNumberClick(clickedRow: number, isShiftKey: boolean, isCtrlKey: boolean): boolean {
        log('log', this.options.verbose, `Row ${clickedRow} clicked. Shift: ${isShiftKey}, Ctrl: ${isCtrlKey}`);
        const selectedRows = new Set(this.stateManager.getSelectedRows());
        let lastClickedRow = this.stateManager.getLastClickedRow();

        // Store original state for comparison
        const originalSelectedRowsJson = JSON.stringify(Array.from(selectedRows).sort());
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
            if (JSON.stringify(Array.from(newSelectedRows).sort()) !== originalSelectedRowsJson) {
                this.stateManager.setSelectedRows(newSelectedRows, lastClickedRow); // Keep original lastClicked for subsequent shifts
            }
            log('log', this.options.verbose, "Selected rows (Shift):", Array.from(newSelectedRows).sort((a, b) => a - b));

        } else if (isCtrlKey) {
            // --- Ctrl Click Logic ---
            if (selectedRows.has(clickedRow)) {
                selectedRows.delete(clickedRow);
            } else {
                selectedRows.add(clickedRow);
            }
            lastClickedRow = clickedRow; // Update last clicked for subsequent Ctrl/Shift
            this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
            log('log', this.options.verbose, "Selected rows (Ctrl):", Array.from(selectedRows).sort((a, b) => a - b));
        } else {
            // --- Single Click Logic ---
            selectedRows.clear();
            selectedRows.add(clickedRow);
            lastClickedRow = clickedRow;
            this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
            log('log', this.options.verbose, "Selected rows (Single):", Array.from(selectedRows).sort((a, b) => a - b));
        }

        // Check if the primary state actually changed
        const rowsChanged = JSON.stringify(Array.from(this.stateManager.getSelectedRows()).sort()) !== originalSelectedRowsJson;
        const lastClickChanged = this.stateManager.getLastClickedRow() !== originalLastClickedRow;
        const changed = rowsChanged || lastClickChanged;

        // If row selection changed, clear other selections
        if (changed) {
            this.stateManager.setActiveCell(null);      // Clear active cell
            this.stateManager.clearSelectionRange();    // Clear cell selection range
            this.stateManager.setSelectedColumn(null); // Clear column selection
        }

        return changed;
    }

    /** Returns true if selection state changed */
    public handleHeaderClick(clickedCol: number): boolean {
        log('log', this.options.verbose, `Column ${clickedCol} clicked.`);
        const selectedColumn = this.stateManager.getSelectedColumn();

        this.stateManager.setSelectedColumn(clickedCol);

        const changed = selectedColumn !== clickedCol;
        // If column selection changed, clear other selections
        if (changed) {
            this.stateManager.setActiveCell(null);      // Clear active cell
            this.stateManager.clearSelectionRange();    // Clear cell selection range
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
    public checkResizeHandles(event: MouseEvent): 'column' | 'row' | null {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentX = viewportX + this.stateManager.getScrollLeft();
        const contentY = viewportY + this.stateManager.getScrollTop();
        const { headerHeight, rowNumberWidth, resizeHandleSize, defaultRowHeight } = this.options;
        const columns = this.stateManager.getColumns();
        const dataLength = this.stateManager.dataLength;
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();

        // Check Column Resize Handles (in header)
        if (contentY < headerHeight && contentX > rowNumberWidth) {
            let currentX = rowNumberWidth;
            for (let col = 0; col < columns.length; col++) {
                const colWidth = columnWidths[col];
                const borderX = currentX + colWidth;
                if (Math.abs(contentX - borderX) <= resizeHandleSize) {
                    this._startColumnResize(col, event.clientX);
                    return 'column';
                }
                currentX = borderX;
            }
        }

        // Check Row Resize Handles (in row number area)
        if (contentX < rowNumberWidth && contentY > headerHeight) {
            let currentY = headerHeight;
            for (let row = 0; row < dataLength; row++) {
                const rowHeight = rowHeights.get(row) || defaultRowHeight;
                const borderY = currentY + rowHeight;
                if (Math.abs(contentY - borderY) <= resizeHandleSize) {
                    this._startRowResize(row, event.clientY);
                    return 'row';
                }
                currentY = borderY;
            }
        }

        return null;
    }

    private _startColumnResize(colIndex: number, startX: number): void {
        log('log', this.options.verbose, `Starting column resize for index ${colIndex}`);
        this.stateManager.setResizeColumnState({
            isResizing: true,
            columnIndex: colIndex,
            startX: startX,
        });
        this.domManager.setCursor('col-resize');
    }

    private _startRowResize(rowIndex: number, startY: number): void {
        log('log', this.options.verbose, `Starting row resize for index ${rowIndex}`);
        this.stateManager.setResizeRowState({
            isResizing: true,
            rowIndex: rowIndex,
            startY: startY,
        });
        this.domManager.setCursor('row-resize');
    }

    public handleResizeMouseMove(event: MouseEvent): void {
        const columnResizeState = this.stateManager.getResizeColumnState();
        const rowResizeState = this.stateManager.getResizeRowState();

        if (columnResizeState.isResizing && columnResizeState.columnIndex !== null && columnResizeState.startX !== null) {
            const { minColumnWidth, maxColumnWidth } = this.options;
            const deltaX = event.clientX - columnResizeState.startX;
            const originalWidths = this.stateManager.getColumnWidths();
            const colIndex = columnResizeState.columnIndex;
            const originalWidth = originalWidths[colIndex];
            let newWidth = originalWidth + deltaX;

            newWidth = Math.max(minColumnWidth, Math.min(newWidth, maxColumnWidth));

            if (newWidth !== originalWidth) {
                const newWidths = [...originalWidths];
                newWidths[colIndex] = newWidth;
                this.stateManager.setColumnWidths(newWidths);
                this.stateManager.setResizeColumnState({ ...columnResizeState, startX: event.clientX }); // Update startX
                this.dimensionCalculator.calculateTotalSize(); // Recalculate total size
                this.dimensionCalculator.calculateVisibleRange(); // Visible range might change
                this.domManager.updateCanvasSize(this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight()); // Update canvas display size
                this.renderer.draw(); // Redraw with new size
            }
        } else if (rowResizeState.isResizing && rowResizeState.rowIndex !== null && rowResizeState.startY !== null) {
            const { minRowHeight, maxRowHeight } = this.options;
            const deltaY = event.clientY - rowResizeState.startY;
            const rowIndex = rowResizeState.rowIndex;
            const originalHeight = this.stateManager.getRowHeight(rowIndex);
            let newHeight = originalHeight + deltaY;

            newHeight = Math.max(minRowHeight, Math.min(newHeight, maxRowHeight));

            if (newHeight !== originalHeight) {
                this.stateManager.setRowHeight(rowIndex, newHeight);
                this.stateManager.setResizeRowState({ ...rowResizeState, startY: event.clientY }); // Update startY
                this.dimensionCalculator.calculateTotalSize();
                this.dimensionCalculator.calculateVisibleRange();
                this.domManager.updateCanvasSize(this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight());
                this.renderer.draw();
            }
        }
    }

    public endResize(): void {
        const columnResizeState = this.stateManager.getResizeColumnState();
        const rowResizeState = this.stateManager.getResizeRowState();

        if (columnResizeState.isResizing) {
            log('log', this.options.verbose, `Finished column resize for index ${columnResizeState.columnIndex}. New width: ${this.stateManager.getColumnWidths()[columnResizeState.columnIndex!]}`);
            this.stateManager.setResizeColumnState({ isResizing: false, columnIndex: null, startX: null });
        }
        if (rowResizeState.isResizing) {
            log('log', this.options.verbose, `Finished row resize for index ${rowResizeState.rowIndex}. New height: ${this.stateManager.getRowHeight(rowResizeState.rowIndex!)}`);
            this.stateManager.setResizeRowState({ isResizing: false, rowIndex: null, startY: null });
        }
        // Cursor update is handled by mouse move/up handler
    }

    public updateCursorStyle(event: MouseEvent): void {
        if (this.stateManager.isResizing() || this.stateManager.isDraggingFillHandle()) return; // Don't change cursor during active drag/resize
        const scrollTop = this.stateManager.getScrollTop();
        const scrollLeft = this.stateManager.getScrollLeft();
        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentX = viewportX + scrollLeft;
        const contentY = viewportY + scrollTop;
        const { headerHeight, rowNumberWidth, resizeHandleSize, defaultRowHeight } = this.options;
        const columns = this.stateManager.getColumns();
        const dataLength = this.stateManager.dataLength;
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();

        let newCursor = 'default';

        // Check Column Resize Handles
        if (contentY < headerHeight && contentX > rowNumberWidth && scrollTop < headerHeight) {
            let currentX = rowNumberWidth;
            for (let col = 0; col < columns.length; col++) {
                const borderX = currentX + columnWidths[col];
                if (Math.abs(contentX - borderX) <= resizeHandleSize) {
                    newCursor = 'col-resize';
                    break;
                }
                currentX = borderX;
                if (currentX > contentX + resizeHandleSize) break; // Optimization
            }
        }

        // Check Row Resize Handles
        if (newCursor === 'default' && contentX < rowNumberWidth && contentY > headerHeight && scrollLeft < rowNumberWidth) {
            let currentY = headerHeight;
            for (let row = 0; row < dataLength; row++) {
                const borderY = currentY + (rowHeights.get(row) || defaultRowHeight);
                if (Math.abs(contentY - borderY) <= resizeHandleSize) {
                    newCursor = 'row-resize';
                    break;
                }
                currentY = borderY;
                if (currentY > contentY + resizeHandleSize) break; // Optimization
            }
        }

        // Check Fill Handle
        const activeCell = this.stateManager.getActiveCell();
        if (newCursor === 'default' && activeCell && activeCell.row !== null && activeCell.col !== null && !this.stateManager.getActiveEditor()) {
            const handleBounds = this.renderer.getFillHandleBounds(activeCell.row, activeCell.col);
            if (handleBounds &&
                contentX >= handleBounds.x && contentX <= handleBounds.x + handleBounds.width &&
                contentY >= handleBounds.y && contentY <= handleBounds.y + handleBounds.height) {
                newCursor = 'crosshair';
            }
        }

        this.domManager.setCursor(newCursor);
    }


    // --- Fill Handle --- HINT HINT
    public checkFillHandle(event: MouseEvent): boolean {
        const activeCell = this.stateManager.getActiveCell();
        if (!activeCell || this.stateManager.getActiveEditor() || this.stateManager.isResizing() || activeCell.row === null || activeCell.col === null) {
            return false;
        }

        const handleBounds = this.renderer.getFillHandleBounds(activeCell.row, activeCell.col);
        if (!handleBounds) return false;

        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left + this.stateManager.getScrollLeft();
        const viewportY = event.clientY - rect.top + this.stateManager.getScrollTop();

        if (viewportX >= handleBounds.x && viewportX <= handleBounds.x + handleBounds.width &&
            viewportY >= handleBounds.y && viewportY <= handleBounds.y + handleBounds.height) {
            this._startFillHandleDrag(activeCell);
            return true;
        }
        return false;
    }

    private _startFillHandleDrag(startCell: CellCoords): void {
        if (startCell.row === null || startCell.col === null) return;
        this.stateManager.setDragState({
            isDragging: true,
            startCell: { ...startCell },
            endRow: startCell.row, // Initially end row is the start row
        });
        this.domManager.setCursor('crosshair');
        log('log', this.options.verbose, "Started dragging fill handle from", startCell);
    }

    public handleFillHandleMouseMove(event: MouseEvent): void {
        if (!this.stateManager.isDraggingFillHandle()) return;

        const startCell = this.stateManager.getDragStartCell();
        if (!startCell || startCell.row === null) return;

        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportY = event.clientY - rect.top + this.stateManager.getScrollTop();
        const { headerHeight, defaultRowHeight } = this.options;
        const rowHeights = this.stateManager.getRowHeights();
        const dataLength = this.stateManager.dataLength;

        let targetRow: number | null = null;
        let currentY = headerHeight;
        for (let i = 0; i < dataLength; i++) {
            const rowHeight = rowHeights.get(i) || defaultRowHeight;
            if (viewportY >= currentY && viewportY < currentY + rowHeight) {
                targetRow = i;
                break;
            }
            currentY += rowHeight;
            if (currentY > viewportY) break; // Optimization
        }

        let newEndRow = this.stateManager.getDragEndRow();

        if (targetRow !== null) {
            // Allow dragging in any direction (up or down)
            newEndRow = targetRow;
        } else if (viewportY < headerHeight) {
            // Mouse is above the header, clamp to first row
            newEndRow = 0;
        } else {
            // Mouse is below the last row, clamp to last row
            newEndRow = dataLength - 1;
        }

        if (newEndRow !== this.stateManager.getDragEndRow()) {
            this.stateManager.setDragState({ // Only update endRow
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
        log('log', this.options.verbose, "Finished dragging fill handle to row", dragEndRow);

        this._performFill();

        this.stateManager.setDragState({ isDragging: false, startCell: null, endRow: null });
        // Cursor update handled by general mouse up handler
        // Redraw happens because state changed and is needed after fill
    }

    private _performFill(): void {
        const dragState = this.stateManager.getDragState();
        // Add explicit checks for startCell and endRow being non-null
        if (!dragState.isDragging || !dragState.startCell || dragState.endRow === null || dragState.startCell.row === null) {
            return;
        }

        // Now we know startCell and endRow are not null
        const startCell = dragState.startCell; // Assign to new const for type narrowing
        const endRow = dragState.endRow;       // Assign to new const for type narrowing
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
                log('log', this.options.verbose, `Skipping fill for disabled cell ${row},${startCol}`);
                continue;
            }

            // Optional: Keep type check for robustness
            if (targetSchema?.type !== sourceType) {
                log('log', this.options.verbose, `Skipping fill for row ${row}: Type mismatch (Source: ${sourceType}, Target: ${targetSchema?.type})`);
                continue;
            }

            const currentValue = this.stateManager.getCellData(row, startCol);
            if (currentValue !== sourceValue) {
                // Use StateManager to update the cell value internally
                const oldValue = this.stateManager.updateCellInternal(row, startCol, sourceValue);
                // Crucially, update disabled states for the row *after* changing the value
                cellUpdates.push(row);
                oldRows.push({ [sourceColumnKey]: oldValue });
                changed = true;
            }
        }

        if (changed) {
            this.renderer.draw();
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
    public _batchUpdateCellsAndNotify(rows: number[], updateColumns: string[], oldRows?: any[]): void {
        if (!rows || rows.length === 0) return;
        // Then update disabled states for each affected row
        const updatedRows: CellUpdateEvent[] = [];
        rows.forEach((rowIndex, index) => {
            this.stateManager.updateDisabledStatesForRow(rowIndex);
            updatedRows.push({
                rowIndex,
                columnKeys: updateColumns,
                data: this.stateManager.getRowData(rowIndex)!,
                oldData: oldRows?.[index]
            });
        });

        // Record history only if not a parent app update
        if (!this.historyManager.isParentAppUpdate()) {
            this.historyManager.recordChanges(updatedRows);
        }

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
                log('warn', this.options.verbose, "Copied range contains mixed data types.");
                // Decide if copy should be prevented or allowed with warning
            }

            // Store both the data and the source range
            changed = this.stateManager.setCopiedRange(rangeData, selectionRange);
            log('log', this.options.verbose, `Copied range data [${rangeData.length}x${rangeData[0]?.length}] from source range [${start.row},${start.col}] -> [${end.row},${end.col}]`);

        } else if (activeCell && activeCell.row !== null && activeCell.col !== null) {
            // Copy single cell (this already clears range state via setCopiedValue)
            const { row, col } = activeCell;
            const value = this.stateManager.getCellData(row, col);
            const type = this.stateManager.getSchemaForColumn(col)?.type;
            changed = this.stateManager.setCopiedValue(value, type, { ...activeCell });
            if (changed) {
                log('log', this.options.verbose, `Copied value: ${value} (Type: ${type}) from cell ${row},${col}`);
            }
        }
        return changed;
    }

    /** Pastes single value or range. Returns true if paste occurred and requires redraw. */
    public paste(): boolean {
        if (this.lastPasteHandledAt && (Date.now() - this.lastPasteHandledAt.getTime() < 1000)) {
            return false;
        }
        this.lastPasteHandledAt = new Date();

        log('log', this.options.verbose, "Paste requested by keyboard shortcut");
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
        const targetCell = (!targetRange && activeCell) ? activeCell : null;

        if (!targetRange && !targetCell) {
            log('log', this.options.verbose, "Paste ignored: No target cell or range selected.");
            return false;
        }

        if (copiedRangeData) {
            log('log', this.options.verbose, "Pasting range data");
            // Always paste range data into range (if targetRange) or from top-left (if activeCell)
            if (targetRange) {
                return this._pasteRangeToRange(targetRange, copiedRangeData);
            } else if (targetCell && targetCell.row !== null && targetCell.col !== null) {
                return this._pasteRangeFromTopLeft(targetCell, copiedRangeData);
            } else {
                return false;
            }
        } else if (copiedValue !== undefined) {
            log('log', this.options.verbose, "Pasting single value");
            // Always paste the single value into range (if targetRange) or cell (if activeCell)
            if (targetRange) {
                return this._pasteSingleValueToRange(targetRange, copiedValue, copiedValueType);
            } else if (targetCell && targetCell.row !== null && targetCell.col !== null) {
                return this._pasteSingleValue(targetCell, copiedValue, copiedValueType);
            } else {
                return false;
            }
        } else {
            log('log', this.options.verbose, "Nothing to paste.");
            return false;
        }
    }

    /** Case 1: Paste single value to single cell */
    private _pasteSingleValue(targetCell: CellCoords, value: any, valueType: DataType | undefined): boolean {
        if (targetCell.row === null || targetCell.col === null) return false;

        const targetRow = targetCell.row;
        const targetCol = targetCell.col;
        const targetColKey = this.stateManager.getColumnKey(targetCol);
        const targetSchema = this.stateManager.getSchemaForColumn(targetCol);

        if (this.stateManager.isCellDisabled(targetRow, targetCol)) {
            log('log', this.options.verbose, `Paste cancelled: Target cell ${targetRow},${targetCol} is disabled.`);
            return false;
        }

        if (targetSchema?.type !== valueType && value !== null) {
            log('log', this.options.verbose, `Type mismatch (Copied: ${valueType}, Target: ${targetSchema?.type}) - attempting conversion.`);
            // We'll try to convert the value to match the target schema
            const convertedValue = this._convertValueForTargetType(value, targetColKey, targetSchema);
            if (convertedValue === null) {
                log('log', this.options.verbose, `Paste cancelled: Cannot convert value between types.`);
                return false;
            }
            value = convertedValue;
        }
        const currentValue = this.stateManager.getCellData(targetRow, targetCol);
        const validationResult = validateInput(value, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
        if ('error' in validationResult) {
            log('log', this.options.verbose, validationResult.error);
            if (validationResult.errorType === 'required' && !currentValue) {
                this.stateManager.updateCell(targetRow, `error:${targetColKey}`, validationResult.error);
            } else {
                this.renderer.setTemporaryErrors([{ row: targetRow, col: targetCol, error: validationResult.error }]);
            }
            return true;// redraw required for error
        } else {
            this.stateManager.removeCellValue(targetRow, `error:${targetColKey}`);
        }
        if (currentValue !== value) {
            const oldValue = this.stateManager.updateCellInternal(targetRow, targetCol, value);
            this._batchUpdateCellsAndNotify([targetRow], [targetColKey], [{ [targetColKey]: oldValue }]);
            log('log', this.options.verbose, `Pasted value ${value} to cell ${targetRow},${targetCol}`);
            return true;
        }
        return false;
    }

    /** Case 2: Paste single value to a selected range */
    private _pasteSingleValueToRange(targetRange: { start: CellCoords, end: CellCoords }, value: any, valueType: DataType | undefined): boolean {
        let changed = false;
        const affectedRows: number[] = [];
        const affectedColumns: string[] = [];
        const oldRows = new Map<number, any>();
        for (let row = targetRange.start.row!; row <= targetRange.end.row!; row++) {
            for (let col = targetRange.start.col!; col <= targetRange.end.col!; col++) {
                const targetColKey = this.stateManager.getColumnKey(col);
                const targetSchema = this.stateManager.getSchemaForColumn(col);

                // Skip if disabled
                if (this.stateManager.isCellDisabled(row, col)) continue;

                // Handle type conversion if needed
                let valueToUse = value;
                if (targetSchema?.type !== valueType && value !== null) {
                    valueToUse = this._convertValueForTargetType(value, targetColKey, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                const currentValue = this.stateManager.getCellData(row, col);
                // Validate value for the target cell
                const validationResult = validateInput(valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
                if ('error' in validationResult) {
                    log('warn', this.options.verbose, validationResult.error);
                    if (validationResult.errorType === 'required' && !currentValue) {
                        this.stateManager.updateCell(row, `error:${targetColKey}`, validationResult.error);
                    } else {
                        this.renderer.setTemporaryErrors([{ row, col, error: validationResult.error }]);
                    }
                    changed = true;
                    // TODO: add to affectedRows and affectedColumns
                    continue;
                } else {
                    this.stateManager.removeCellValue(row, `error:${targetColKey}`);
                }

                if (currentValue !== valueToUse) {
                    const oldValue = this.stateManager.updateCellInternal(row, col, valueToUse);
                    affectedRows.push(row);
                    affectedColumns.push(targetColKey);
                    oldRows.set(row, { ...oldRows.get(row), [targetColKey]: oldValue });
                    changed = true;
                }
            }
        }

        // Update disabled states for all affected rows
        if (affectedRows.length > 0) {
            this._batchUpdateCellsAndNotify(affectedRows, affectedColumns, affectedRows.map(m => oldRows.get(m)));
        }
        if (changed) {
            log('log', this.options.verbose, `Pasted single value to range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
        }
        return changed;
    }

    /** Helper method to convert values between different data types */
    private _convertValueForTargetType(value: any, colKey: string, schema?: ColumnSchema): any {
        const targetType = schema?.type;
        if (value === null || value === undefined || targetType === undefined) {
            return null;
        }

        // Convert any value to string for display/text fields
        if (targetType === 'text' || targetType === 'email') {
            return String(value);
        }

        const stringValue = String(value).trim();
        if (stringValue === '') return null;

        switch (targetType) {
            case 'number':
                const num = parseFloat(stringValue);
                return isNaN(num) ? null : num;

            case 'boolean':
                if (typeof value === 'boolean') return value;
                const lower = stringValue.toLowerCase();
                if (['true', 'yes', '1', 'y'].includes(lower)) return true;
                if (['false', 'no', '0', 'n'].includes(lower)) return false;
                return null;

            case 'date':
                if (value instanceof Date) return value.toISOString().split('T')[0];

                try {
                    // Handle numeric timestamps and various date formats
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString().split('T')[0]; // YYYY-MM-DD format
                    }
                } catch (e) { }
                return null;

            case 'select':
                // For select, we need to check if the value matches any option id or name
                const cachedOptions = this.stateManager.cachedDropdownOptionsByColumn.get(colKey);
                if (!cachedOptions) return null;
                // Try to match by raw id
                if (cachedOptions.has(value)) return value;
                // Try to match by string value id if the original value is not a string
                if (typeof value !== 'string' && cachedOptions.has(stringValue)) return stringValue;
                // If not found by id, try to match by name
                const option = Array.from(cachedOptions.entries()).find(([_key, option]) =>
                    option.toLowerCase() === stringValue.toLowerCase());
                return option ? option[0] : null;
            default:
                return null;
        }
    }

    /** Case 3: Paste range starting from a single top-left cell */
    private _pasteRangeFromTopLeft(startCell: CellCoords, rangeData: any[][]): boolean {
        if (startCell.row === null || startCell.col === null || !rangeData || rangeData.length === 0) {
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
                    valueToUse = this._convertValueForTargetType(valueToPaste, targetColKey, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                const currentValue = this.stateManager.getCellData(targetRow, targetCol);
                const validationResult = validateInput(valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
                if ('error' in validationResult) {
                    log('warn', this.options.verbose, validationResult.error);
                    if (validationResult.errorType === 'required' && !currentValue) {
                        this.stateManager.updateCell(targetRow, `error:${targetColKey}`, validationResult.error);
                    } else {
                        this.renderer.setTemporaryErrors([{ row: targetRow, col: targetCol, error: validationResult.error }]);
                    }
                    changed = true;
                    // TODO: add to affectedRows and affectedColumns
                    continue;
                } else {
                    this.stateManager.removeCellValue(targetRow, `error:${targetColKey}`);
                }

                if (currentValue !== valueToUse) {
                    const oldValue = this.stateManager.updateCellInternal(targetRow, targetCol, valueToUse);
                    rowChanged = true;
                    affectedColumns.add(targetColKey);
                    oldRows.set(targetRow, { ...oldRows.get(targetRow), [targetColKey]: oldValue });
                }
            }

            if (rowChanged) {
                affectedRows.push(targetRow);
                changed = true;
            }
        }

        if (affectedRows.length > 0) {
            this._batchUpdateCellsAndNotify(affectedRows, Array.from(affectedColumns), affectedRows.map(m => oldRows.get(m)));
            log('log', this.options.verbose, `Pasted range [${numRowsToPaste}x${numColsToPaste}] starting at ${startRow},${startCol}`);
        }

        return changed;
    }

    /** Case 4: Paste range into a selected range (repeating pattern) */
    private _pasteRangeToRange(targetRange: { start: CellCoords, end: CellCoords }, sourceRangeData: any[][]): boolean {
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
            for (let col = targetRange.start.col!; col <= targetRange.end.col!; col++) {
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
                    valueToUse = this._convertValueForTargetType(valueToPaste, targetColKey, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                const currentValue = this.stateManager.getCellData(row, col);
                // Validate value
                const validationResult = validateInput(valueToUse, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
                if ('error' in validationResult) {
                    log('warn', this.options.verbose, validationResult.error);
                    if (validationResult.errorType === 'required' && !currentValue) {
                        this.stateManager.updateCell(row, `error:${targetColKey}`, validationResult.error);
                    } else {
                        this.renderer.setTemporaryErrors([{ row, col, error: validationResult.error }]);
                    }
                    changed = true;
                    // TODO: add to affectedRows and affectedColumns
                    continue;
                } else {
                    this.stateManager.removeCellValue(row, `error:${targetColKey}`);
                }

                if (currentValue !== valueToUse) {
                    const oldValue = this.stateManager.updateCellInternal(row, col, valueToUse);
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
            this._batchUpdateCellsAndNotify(affectedRows, Array.from(affectedColumns), affectedRows.map(m => oldRows.get(m)));
            log('log', this.options.verbose, `Pasted range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
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
        log('log', this.options.verbose, "Deleting rows:", rowsToDelete);

        const selectedRowData = rowsToDelete.map(rowIndex => this.stateManager.getRowData(rowIndex)!).filter(row => row);
        let deletedCount = this.stateManager.deleteRows(rowsToDelete);
        try {
            this.options.onRowDeleted?.(selectedRowData);
        } catch (error) {
            log('error', this.options.verbose, `Error calling onRowDeleted: ${error}`);
        }

        if (deletedCount > 0) {
            this.clearSelections();
            this.stateManager.setActiveCell(null);
            this.clearCopiedCell();

            // Recalculate everything after deletion
            this.triggerCustomEvent('resize');
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
        const rangeChanged = this.stateManager.setSelectionRange(startCoords, startCoords);
        primaryChanged = activeChanged || rangeChanged;

        // If primary state changed, clear other selection types
        let rowsCleared = false;
        if (primaryChanged) {
            rowsCleared = this.clearSelections();
        }

        if (primaryChanged || rowsCleared) {
            log('log', this.options.verbose, `Started selection drag at ${startCoords.row},${startCoords.col}`);
            return true;
        }
        return false;
    }

    /** Updates the end cell of the selection drag */
    public updateSelectionDrag(endCoords: CellCoords): boolean {
        if (!this.stateManager.getIsDraggingSelection() || !this.stateManager.getSelectionStartCell()) {
            return false;
        }
        // Only update if the end cell is valid
        if (endCoords.row === null || endCoords.col === null) return false;

        // Only redraw if the end cell actually changes
        const currentEnd = this.stateManager.getSelectionEndCell();
        if (currentEnd?.row !== endCoords.row || currentEnd?.col !== endCoords.col) {
            log('log', this.options.verbose, `Updating selection drag to ${endCoords.row},${endCoords.col}`);
            // Keep the original start cell, only update the end cell
            return this.stateManager.setSelectionRange(this.stateManager.getSelectionStartCell(), endCoords);
        }
        return false;
    }

    /** Ends the cell selection drag */
    public endSelectionDrag(): void {
        if (this.stateManager.getIsDraggingSelection()) {
            log('log', this.options.verbose, `Ended selection drag. Final range: ${JSON.stringify(this.stateManager.getNormalizedSelectionRange())}`);
            this.stateManager.setDraggingSelection(false);
            // Final range is already set by updateSelectionDrag
        }
    }

    // --- Cell Navigation (used by editing manager on Enter/Tab) ---
    // returns true if redraw is needed
    public moveActiveCell(rowDelta: number, colDelta: number, activateEditor = true): boolean {
        const { verbose, autoAddNewRow } = this.options;
        if (!this.editingManager) {
            log('warn', verbose, "EditingManager not set, cannot move active cell.");
            return false;
        }
        const shouldAddRow = autoAddNewRow && activateEditor;
        const currentActiveCell = this.stateManager.getActiveCell();
        if (!currentActiveCell || currentActiveCell.row === null || currentActiveCell.col === null) return false;

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
            log('log', verbose, "Reached grid boundary, deactivating editor.");
            return true;
        }

        if (nextRow === numRows && shouldAddRow) {
            // Reached bottom edge, add a new row
            nextRow = this.stateManager.addRow();
            // trigger resize to recalculate dimensions
            this.triggerCustomEvent('resize');
            numRows++;
        }

        // Find the next *editable* cell in the specified direction
        // This is a simplified search; a more robust one might be needed for large sparse disabled areas
        let safetyCounter = (nextRow * numCols) + nextCol; // start at current cell
        const maxSearch = numRows * numCols; // Limit search iterations

        while (this.stateManager.isCellDisabled(nextRow, nextCol) && safetyCounter < maxSearch) {
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
                log('warn', verbose, "Could not find next editable cell in direction.");
                return true;
            }
        }

        if (safetyCounter >= maxSearch) {
            log('warn', verbose, "Max search limit reached while finding next editable cell.");
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
    public pasteSingleValueExternal(targetCell: CellCoords, value: string): boolean {
        // Treat external paste as text, only allow pasting into text cells for simplicity
        // Could be enhanced to try parsing based on target cell type
        if (targetCell.row === null || targetCell.col === null) return false;
        const targetSchema = this.stateManager.getSchemaForColumn(targetCell.col);
        if (targetSchema?.type !== 'text') {
            log('log', this.options.verbose, `Clipboard paste cancelled: Target cell ${targetCell.row},${targetCell.col} is not type 'text'.`);
            return false;
        }
        // Use the existing single value paste logic, forcing type 'text'
        return this._pasteSingleValue(targetCell, value, 'text');
    }

    /** Pastes external 2D string array starting from a single top-left cell */
    public pasteRangeFromTopLeftExternal(startCell: CellCoords, rangeData: string[][]): boolean {
        // Similar to _pasteRangeFromTopLeft, but assumes string data and checks target type
        if (startCell.row === null || startCell.col === null || !rangeData || rangeData.length === 0) {
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
                if (targetSchema?.type !== 'text') {
                    log('log', this.options.verbose, `Clipboard paste range: Target cell ${targetRow},${targetCol} is not type 'text'. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(targetRow, targetCol);
                const validationResult = validateInput(valueToPaste, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
                if ('error' in validationResult) {
                    log('warn', this.options.verbose, validationResult.error);
                    if (validationResult.errorType === 'required' && !currentValue) {
                        this.stateManager.updateCell(targetRow, `error:${targetColKey}`, validationResult.error);
                    } else {
                        this.renderer.setTemporaryErrors([{ row: targetRow, col: targetCol, error: validationResult.error }]);
                    }
                    changed = true;
                    // TODO: add to affectedRows and affectedColumns
                    continue;
                } else {
                    this.stateManager.removeCellValue(targetRow, `error:${targetColKey}`);
                }

                if (currentValue !== valueToPaste) {
                    this.stateManager.updateCellInternal(targetRow, targetCol, valueToPaste);
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
            this._batchUpdateCellsAndNotify(affectedRows, Array.from(affectedColumns));
            log('log', this.options.verbose, `Pasted external range [${numRowsToPaste}x${numColsToPaste}] starting at ${startRow},${startCol}`);
        }

        return changed;
    }

    /** Pastes external 2D string array into a selected range (repeating pattern) */
    public pasteRangeToRangeExternal(targetRange: { start: CellCoords, end: CellCoords }, sourceRangeData: string[][]): boolean {
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
            for (let col = targetRange.start.col!; col <= targetRange.end.col!; col++) {
                const sourceRowIndex = (row - targetRange.start.row!) % sourceRows;
                const sourceColIndex = (col - targetRange.start.col!) % sourceCols;
                const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex]; // String from clipboard

                const targetColKey = this.stateManager.getColumnKey(col);
                const targetSchema = this.stateManager.getSchemaForColumn(col);

                if (this.stateManager.isCellDisabled(row, col)) continue;

                // Convert based on target cell type
                const convertedValue = this._convertValueForTargetType(valueToPaste, targetColKey, targetSchema);
                if (convertedValue === null) continue; // Skip if conversion not possible

                const currentValue = this.stateManager.getCellData(row, col);
                const validationResult = validateInput(convertedValue, targetSchema, targetColKey, this.stateManager.cachedDropdownOptionsByColumn.get(targetColKey), this.options.verbose);
                if ('error' in validationResult) {
                    log('warn', this.options.verbose, validationResult.error);
                    if (validationResult.errorType === 'required' && !currentValue) {
                        this.stateManager.updateCell(row, `error:${targetColKey}`, validationResult.error);
                    } else {
                        this.renderer.setTemporaryErrors([{ row, col, error: validationResult.error }]);
                    }
                    changed = true;
                    // TODO: add to affectedRows and affectedColumns
                    continue;
                } else {
                    this.stateManager.removeCellValue(row, `error:${targetColKey}`);
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
            this._batchUpdateCellsAndNotify(affectedRows, Array.from(affectedColumns));
            log('log', this.options.verbose, `Pasted external range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
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
        log('log', this.options.verbose, `External paste to entire column ${columnIndex}`);
        const schemaColumn = this.stateManager.getSchemaForColumn(columnIndex);
        const dataLength = this.stateManager.dataLength;
        let changedAny = false;

        if (value === undefined || value === null) {
            log('log', this.options.verbose, "No value to paste to column");
            return false;
        }
        const colKey = this.stateManager.getColumnKey(columnIndex);
        // Convert value to correct type for the column
        const convertedValue = this._convertValueForTargetType(value, colKey, schemaColumn);
        // Apply to all cells in the column
        const affectedRows: number[] = [];
        for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
            // Skip disabled cells
            if (this.stateManager.isCellDisabled(rowIndex, columnIndex)) continue;

            const currentValue = this.stateManager.getCellData(rowIndex, columnIndex);
            if (currentValue !== convertedValue) {
                this.stateManager.updateCellInternal(rowIndex, columnIndex, convertedValue);
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
