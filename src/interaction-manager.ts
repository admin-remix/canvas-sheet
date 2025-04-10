// src/interaction-manager.ts

import {
    RequiredSpreadsheetOptions,
    CellCoords,
    ResizeColumnState,
    ResizeRowState,
    DataType,
    ColumnSchema
} from './types';
import { StateManager } from './state-manager';
import { Renderer } from './renderer';
import { DimensionCalculator } from './dimension-calculator';
import { log, validateInput } from './utils';
import { DomManager } from './dom-manager';
import { EditingManager } from './editing-manager'; // Needed for moving active cell
import { DISABLED_FIELD_PREFIX } from './config';

export class InteractionManager {
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;
    private renderer: Renderer;
    private dimensionCalculator: DimensionCalculator;
    private domManager: DomManager;
    private editingManager!: EditingManager; // Use definite assignment assertion

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

    // Setter for circular dependency
    public setEditingManager(editingManager: EditingManager): void {
        this.editingManager = editingManager;
    }

    // --- Row Selection ---
    /** Returns true if selection state changed */
    public handleRowNumberClick(clickedRow: number, isShiftKey: boolean, isCtrlKey: boolean): boolean {
        log('log', this.options.verbose, `Row ${clickedRow} clicked. Shift: ${isShiftKey}, Ctrl: ${isCtrlKey}`);
        const selectedRows = new Set(this.stateManager.getSelectedRows());
        let lastClickedRow = this.stateManager.getLastClickedRow();
        const initialSelectedRows = JSON.stringify(Array.from(selectedRows).sort());
        const initialLastClickedRow = lastClickedRow;

        if (isShiftKey && lastClickedRow !== null) {
            selectedRows.clear();
            const start = Math.min(lastClickedRow, clickedRow);
            const end = Math.max(lastClickedRow, clickedRow);
            for (let i = start; i <= end; i++) {
                selectedRows.add(i);
            }
            log('log', this.options.verbose, "Selected rows (Shift):", Array.from(selectedRows).sort((a, b) => a - b));
        } else if (isCtrlKey) {
            if (selectedRows.has(clickedRow)) {
                selectedRows.delete(clickedRow);
            } else {
                selectedRows.add(clickedRow);
            }
            lastClickedRow = clickedRow;
            log('log', this.options.verbose, "Selected rows (Ctrl):", Array.from(selectedRows).sort((a, b) => a - b));
        } else {
            selectedRows.clear();
            selectedRows.add(clickedRow);
            lastClickedRow = clickedRow;
            log('log', this.options.verbose, "Selected rows (Single):", Array.from(selectedRows).sort((a, b) => a - b));
        }
        // Use the state manager's method to update and check if changed
        return this.stateManager.setSelectedRows(selectedRows, lastClickedRow);
    }

    /** Returns true if selections were cleared */
    public clearSelections(): boolean {
        if (this.stateManager.getSelectedRows().size > 0) {
            return this.stateManager.setSelectedRows(new Set(), null);
        }
        return false;
    }

    // --- Resizing --- HINT HINT
    public checkResizeHandles(event: MouseEvent): 'column' | 'row' | null {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentX = viewportX + this.stateManager.getScrollLeft();
        const contentY = viewportY + this.stateManager.getScrollTop();
        const { headerHeight, rowNumberWidth, resizeHandleSize } = this.options;
        const columns = this.stateManager.getColumns();
        const data = this.stateManager.getData();
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
            for (let row = 0; row < data.length; row++) {
                const rowHeight = rowHeights[row];
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
            const originalHeights = this.stateManager.getRowHeights();
            const rowIndex = rowResizeState.rowIndex;
            const originalHeight = originalHeights[rowIndex];
            let newHeight = originalHeight + deltaY;

            newHeight = Math.max(minRowHeight, Math.min(newHeight, maxRowHeight));

            if (newHeight !== originalHeight) {
                const newHeights = [...originalHeights];
                newHeights[rowIndex] = newHeight;
                this.stateManager.setRowHeights(newHeights);
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
            log('log', this.options.verbose, `Finished row resize for index ${rowResizeState.rowIndex}. New height: ${this.stateManager.getRowHeights()[rowResizeState.rowIndex!]}`);
            this.stateManager.setResizeRowState({ isResizing: false, rowIndex: null, startY: null });
        }
        // Cursor update is handled by mouse move/up handler
    }

    public updateCursorStyle(event: MouseEvent): void {
        if (this.stateManager.isResizing() || this.stateManager.isDraggingFillHandle()) return; // Don't change cursor during active drag/resize

        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentX = viewportX + this.stateManager.getScrollLeft();
        const contentY = viewportY + this.stateManager.getScrollTop();
        const { headerHeight, rowNumberWidth, resizeHandleSize } = this.options;
        const columns = this.stateManager.getColumns();
        const data = this.stateManager.getData();
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();

        let newCursor = 'default';

        // Check Column Resize Handles
        if (contentY < headerHeight && contentX > rowNumberWidth) {
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
        if (newCursor === 'default' && contentX < rowNumberWidth && contentY > headerHeight) {
            let currentY = headerHeight;
            for (let row = 0; row < data.length; row++) {
                const borderY = currentY + rowHeights[row];
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
                viewportX >= handleBounds.x && viewportX <= handleBounds.x + handleBounds.width &&
                viewportY >= handleBounds.y && viewportY <= handleBounds.y + handleBounds.height) {
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
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;

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
        const viewportY = event.clientY - rect.top;
        const contentY = viewportY + this.stateManager.getScrollTop();
        const headerHeight = this.options.headerHeight;
        const rowHeights = this.stateManager.getRowHeights();
        const dataLength = this.stateManager.getData().length;

        let targetRow: number | null = null;
        let currentY = headerHeight;
        for (let i = 0; i < dataLength; i++) {
            const rowHeight = rowHeights[i];
            if (contentY >= currentY && contentY < currentY + rowHeight) {
                targetRow = i;
                break;
            }
            currentY += rowHeight;
            if (currentY > contentY) break; // Optimization
        }

        let newEndRow = this.stateManager.getDragEndRow();

        if (targetRow !== null && targetRow >= startCell.row) {
            // Dragging down or at the same level
            newEndRow = targetRow;
        } else {
            // Mouse is above the start row or outside grid vertically
            newEndRow = startCell.row; // Clamp to start row
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

        this._performFillDown();

        this.stateManager.setDragState({ isDragging: false, startCell: null, endRow: null });
        // Cursor update handled by general mouse up handler
        // Redraw happens because state changed and is needed after fill
    }

    private _performFillDown(): void {
        const dragState = this.stateManager.getDragState();
        // Add explicit checks for startCell and endRow being non-null
        if (!dragState.isDragging || !dragState.startCell || dragState.endRow === null || dragState.startCell.row === null || dragState.endRow <= dragState.startCell.row) {
            return;
        }

        // Now we know startCell and endRow are not null
        const startCell = dragState.startCell; // Assign to new const for type narrowing
        const endRow = dragState.endRow;       // Assign to new const for type narrowing
        const startRow = startCell.row;
        const startCol = startCell.col;
        if (startCol === null || startRow === null) return;
        const colKey = this.stateManager.getColumnKey(startCol);
        const sourceValue = this.stateManager.getCellData(startRow, startCol);
        const sourceSchema = this.stateManager.getSchemaForColumn(startCol);
        const sourceType = sourceSchema?.type;
        let changed = false;
        const dataLength = this.stateManager.getData().length; // Cache length

        for (let row = startRow + 1; row <= endRow; row++) {
            if (row >= dataLength) continue; // Ensure row index is valid

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
                this.stateManager.updateCellInternal(row, startCol, sourceValue);
                // Crucially, update disabled states for the row *after* changing the value
                this.stateManager.updateDisabledStatesForRow(row);
                changed = true;
            }
        }

        if (changed) {
            this.renderer.draw();
        }
    }

    // --- Copy/Paste --- HINT HINT
    /** Returns true if copy state changed */
    public copy(): boolean {
        const activeCell = this.stateManager.getActiveCell();
        let changed = false;
        if (activeCell && activeCell.row !== null && activeCell.col !== null) {
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

    /** Returns true if paste occurred and requires redraw */
    public paste(): boolean {
        const activeCell = this.stateManager.getActiveCell();
        const copiedValue = this.stateManager.getCopiedValue();
        const copiedType = this.stateManager.getCopiedValueType();

        if (!activeCell || activeCell.row === null || activeCell.col === null || copiedValue === undefined || copiedType === undefined) {
            log('log', this.options.verbose, `Paste cancelled: No active cell or no copied value.`);
            // Even if paste fails, if there *was* a copied cell, clearing it requires redraw
            return this.clearCopiedCell();
        }

        const targetRow = activeCell.row;
        const targetCol = activeCell.col;
        const targetColKey = this.stateManager.getColumnKey(targetCol);
        const targetSchema = this.stateManager.getSchemaForColumn(targetCol);
        const targetType = targetSchema?.type;

        if (this.stateManager.isCellDisabled(targetRow, targetCol)) {
            log('log', this.options.verbose, `Paste cancelled: Target cell ${targetRow},${targetCol} is disabled.`);
            return this.clearCopiedCell();
        }

        if (targetType !== copiedType) {
            log('log', this.options.verbose, `Paste cancelled: Type mismatch (Copied: ${copiedType}, Target: ${targetType})`);
            return this.clearCopiedCell();
        }

        if (!validateInput(copiedValue, targetSchema, targetColKey, this.options.verbose)) {
            log('log', this.options.verbose, `Paste cancelled: Copied value failed validation for target cell.`);
            return this.clearCopiedCell();
        }

        const currentValue = this.stateManager.getCellData(targetRow, targetCol);
        let pasted = false;
        if (currentValue !== copiedValue) {
            this.stateManager.updateCellInternal(targetRow, targetCol, copiedValue);
            this.stateManager.updateDisabledStatesForRow(targetRow); // Update disabled states after paste
            log('log', this.options.verbose, `Pasted value ${copiedValue} to cell ${targetRow},${targetCol}`);
            pasted = true;
        } else {
            log('log', this.options.verbose, `Paste skipped: Value already matches in cell ${targetRow},${targetCol}`);
        }

        const clearedCopy = this.clearCopiedCell(); // Clear copy state regardless
        return pasted || clearedCopy; // Redraw if pasted OR if copy highlight was cleared
    }

    /** Returns true if copied cell state was cleared */
    public clearCopiedCell(): boolean {
        if (this.stateManager.getCopiedCell()) {
            return this.stateManager.setCopiedValue(undefined, undefined, null);
        }
        return false;
    }

    // --- Deletion --- HINT HINT
    /** Returns true if rows were deleted */
    public deleteSelectedRows(): boolean {
        const selectedRows = this.stateManager.getSelectedRows();
        if (selectedRows.size === 0) return false;

        const rowsToDelete = Array.from(selectedRows).sort((a, b) => b - a);
        log('log', this.options.verbose, "Deleting rows:", rowsToDelete);

        let deletedCount = this.stateManager.deleteRows(rowsToDelete);

        if (deletedCount > 0) {
            this.clearSelections();
            this.stateManager.setActiveCell(null);
            this.clearCopiedCell();

            // Recalculate everything after deletion
            this.dimensionCalculator.initializeSizes(this.stateManager.getData().length);
            this.dimensionCalculator.calculateDimensions(this.stateManager.getViewportWidth(), this.stateManager.getViewportHeight());
            this.domManager.updateCanvasSize(this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight());
            return true; // Indicate redraw needed
        }
        return false;
    }

    // --- Keyboard Navigation/Actions --- HINT HINT
    public handleKeyDown(event: KeyboardEvent): void {
        const isCtrl = event.ctrlKey || event.metaKey; // Meta for Mac
        let redrawNeeded = false;

        if (isCtrl && event.key === 'c') {
            this.copy();
            event.preventDefault();
            // `copy()` handles redraw
        } else if (isCtrl && event.key === 'v') {
            this.paste();
            event.preventDefault();
            // `paste()` handles redraw
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            if (this.stateManager.getSelectedRows().size > 0) {
                this.deleteSelectedRows();
                event.preventDefault();
                // `deleteSelectedRows()` handles redraw
            } else if (this.stateManager.getActiveCell()) {
                // TODO: Implement clearing active cell content (if not disabled)
                log('log', this.options.verbose, "Delete key pressed on active cell - clearing content not yet implemented.");
                 event.preventDefault();
            }
        } else if (event.key.startsWith('Arrow')) {
            // TODO: Implement arrow key navigation for active cell
             log('log', this.options.verbose, "Arrow key navigation not yet implemented.");
            event.preventDefault();
        } else if (event.key === 'Enter' && this.stateManager.getActiveCell()) {
             // TODO: Maybe move down and activate editor?
             const activeCell = this.stateManager.getActiveCell();
             if(activeCell && activeCell.row !== null && activeCell.col !== null && this.editingManager){
                this.editingManager.activateEditor(activeCell.row, activeCell.col);
                event.preventDefault();
             }
        } else if (event.key === 'Tab' && this.stateManager.getActiveCell()){
            this.moveActiveCell(0, event.shiftKey ? -1 : 1);
            event.preventDefault();
        }

        // No general redraw needed here as specific actions handle their own redraws
    }

    // --- Cell Navigation (used by editing manager on Enter/Tab) ---
    public moveActiveCell(rowDelta: number, colDelta: number): void {
        if (!this.editingManager) {
            log('warn', this.options.verbose, "EditingManager not set, cannot move active cell.");
            return;
        }
        const currentActiveCell = this.stateManager.getActiveCell();
        if (!currentActiveCell || currentActiveCell.row === null || currentActiveCell.col === null) return;

        let currentRow = currentActiveCell.row;
        let currentCol = currentActiveCell.col;
        const numRows = this.stateManager.getData().length;
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
        if (nextRow < 0 || nextRow >= numRows) {
            // Reached top/bottom edge, deactivate editing and don't move
            this.editingManager.deactivateEditor(true); // Save previous cell
            this.stateManager.setActiveCell(null);
            this.renderer.draw();
            log('log', this.options.verbose, "Reached grid boundary, deactivating editor.");
            return;
        }

        // Find the next *editable* cell in the specified direction
        // This is a simplified search; a more robust one might be needed for large sparse disabled areas
        let safetyCounter = 0;
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
                this.renderer.draw();
                log('warn', this.options.verbose, "Could not find next editable cell in direction.");
                return;
            }
        }

        if (safetyCounter >= maxSearch) {
             log('warn', this.options.verbose, "Max search limit reached while finding next editable cell.");
             this.editingManager.deactivateEditor(true);
             this.stateManager.setActiveCell(null);
             this.renderer.draw();
             return;
        }

        // Found the next editable cell
        this.stateManager.setActiveCell({ row: nextRow, col: nextCol });
        // Activate the editor in the new cell
        this.editingManager.activateEditor(nextRow, nextCol);
        // activateEditor will handle the redraw
    }
} 