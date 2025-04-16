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
    private lastPasteHandledAt:Date|null = null;// used to prevent multiple pastes in a row

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

    public moveScroll(deltaX: number, deltaY: number, setScroll: boolean = false) {
        return {
            scrollTop: this.domManager.setVScrollPosition( setScroll ? deltaY : this.domManager.getVScrollPosition() + deltaY),
            scrollLeft: this.domManager.setHScrollPosition(setScroll ? deltaX : this.domManager.getHScrollPosition() + deltaX)
        };
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
        const scrollTop = this.stateManager.getScrollTop();
        const scrollLeft = this.stateManager.getScrollLeft();
        const rect = this.domManager.getCanvasBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const contentX = viewportX + scrollLeft;
        const contentY = viewportY + scrollTop;
        const { headerHeight, rowNumberWidth, resizeHandleSize } = this.options;
        const columns = this.stateManager.getColumns();
        const data = this.stateManager.getData();
        const columnWidths = this.stateManager.getColumnWidths();
        const rowHeights = this.stateManager.getRowHeights();

        let newCursor = 'default';

        // Check Column Resize Handles
        if (contentY < headerHeight && contentX > rowNumberWidth && scrollTop<headerHeight) {
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
        if (newCursor === 'default' && contentX < rowNumberWidth && contentY > headerHeight && scrollLeft<rowNumberWidth) {
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
        const headerHeight = this.options.headerHeight;
        const rowHeights = this.stateManager.getRowHeights();
        const dataLength = this.stateManager.getData().length;

        let targetRow: number | null = null;
        let currentY = headerHeight;
        for (let i = 0; i < dataLength; i++) {
            const rowHeight = rowHeights[i];
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
        const colKey = this.stateManager.getColumnKey(startCol);
        const sourceValue = this.stateManager.getCellData(startRow, startCol);
        const sourceSchema = this.stateManager.getSchemaForColumn(startCol);
        const sourceType = sourceSchema?.type;
        let changed = false;
        const dataLength = this.stateManager.getData().length; // Cache length

        // Determine direction and set proper loop bounds
        const isFillingDown = endRow >= startRow;
        const firstRow = isFillingDown ? startRow + 1 : endRow;
        const lastRow = isFillingDown ? endRow : startRow - 1;
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
        if(this.lastPasteHandledAt && (Date.now() - this.lastPasteHandledAt.getTime() < 1000)) {
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
            const convertedValue = this._convertValueForTargetType(value, targetSchema);
            if (convertedValue === null) {
                log('log', this.options.verbose, `Paste cancelled: Cannot convert value between types.`);
                return false;
            }
            value = convertedValue;
        }

        if (!validateInput(value, targetSchema, targetColKey, this.options.verbose)) {
            log('log', this.options.verbose, `Paste cancelled: Copied value failed validation for target cell.`);
            return false;
        }

        const currentValue = this.stateManager.getCellData(targetRow, targetCol);
        if (currentValue !== value) {
            this.stateManager.updateCellInternal(targetRow, targetCol, value);
            this.stateManager.updateDisabledStatesForRow(targetRow);
            log('log', this.options.verbose, `Pasted value ${value} to cell ${targetRow},${targetCol}`);
            return true;
        }
        return false;
    }

    /** Case 2: Paste single value to a selected range */
    private _pasteSingleValueToRange(targetRange: { start: CellCoords, end: CellCoords }, value: any, valueType: DataType | undefined): boolean {
        let changed = false;
        const affectedRows = new Set<number>();

        for (let r = targetRange.start.row!; r <= targetRange.end.row!; r++) {
            for (let c = targetRange.start.col!; c <= targetRange.end.col!; c++) {
                const targetColKey = this.stateManager.getColumnKey(c);
                const targetSchema = this.stateManager.getSchemaForColumn(c);

                // Skip if disabled
                if (this.stateManager.isCellDisabled(r, c)) continue;

                // Handle type conversion if needed
                let valueToUse = value;
                if (targetSchema?.type !== valueType && value !== null) {
                    valueToUse = this._convertValueForTargetType(value, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                // Validate value for the target cell
                if (!validateInput(valueToUse, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `Paste single to range: Value validation failed for cell ${r},${c}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(r, c);
                if (currentValue !== valueToUse) {
                    this.stateManager.updateCellInternal(r, c, valueToUse);
                    affectedRows.add(r);
                    changed = true;
                }
            }
        }

        // Update disabled states for all affected rows
        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
            log('log', this.options.verbose, `Pasted single value to range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
        }
        return changed;
    }

    /** Helper method to convert values between different data types */
    private _convertValueForTargetType(value: any, schema?: ColumnSchema): any {
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
                } catch (e) {}
                return null;
                
            case 'select':
                // For select, we need to check if the value matches any option id or name
                if (schema?.values) {
                    // Try to match by id
                    let option = schema.values.find(opt => String(opt.id) === stringValue);
                    
                    // If not found by id, try to match by name
                    if (!option) {
                        option = schema.values.find(opt => 
                            opt.name.toLowerCase() === stringValue.toLowerCase());
                    }
                    
                    return option ? option.id : null;
                }
                return null;
                
            default:
                return null;
        }
    }

    /** Pastes external single string value to a single cell with type conversion */
    private _pasteExternalSingleValue(targetCell: CellCoords, value: string): boolean {
        if (targetCell.row === null || targetCell.col === null) return false;
        
        const targetSchema = this.stateManager.getSchemaForColumn(targetCell.col);
        const convertedValue = this._convertValueForTargetType(value, targetSchema);
        
        if (convertedValue === null) {
            log('log', this.options.verbose, `External paste cancelled: Cannot convert value for target cell type.`);
            return false;
        }
        
        // Use existing single value paste logic with the converted value
        return this._pasteSingleValue(targetCell, convertedValue, targetSchema?.type);
    }

    /** Pastes external single string value to a range with type conversion per cell */
    private _pasteExternalSingleValueToRange(targetRange: { start: CellCoords, end: CellCoords }, value: string): boolean {
        let changed = false;
        const affectedRows = new Set<number>();

        for (let r = targetRange.start.row!; r <= targetRange.end.row!; r++) {
            for (let c = targetRange.start.col!; c <= targetRange.end.col!; c++) {
                const targetColKey = this.stateManager.getColumnKey(c);
                const targetSchema = this.stateManager.getSchemaForColumn(c);

                // Skip if disabled
                if (this.stateManager.isCellDisabled(r, c)) continue;

                // Convert value for this cell's type
                const convertedValue = this._convertValueForTargetType(value, targetSchema);
                if (convertedValue === null) continue; // Skip if conversion not possible

                // Validate value for the target cell
                if (!validateInput(convertedValue, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `External paste to range: Value validation failed for cell ${r},${c}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(r, c);
                if (currentValue !== convertedValue) {
                    this.stateManager.updateCellInternal(r, c, convertedValue);
                    affectedRows.add(r);
                    changed = true;
                }
            }
        }

        // Update disabled states for all affected rows
        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
            log('log', this.options.verbose, `Pasted external single value to range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
        }
        return changed;
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
        const totalRows = this.stateManager.getData().length;
        const totalCols = this.stateManager.getColumns().length;
        const affectedRows = new Set<number>();

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
                    valueToUse = this._convertValueForTargetType(valueToPaste, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                if (!validateInput(valueToUse, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `Paste range from TL: Value validation failed for cell ${targetRow},${targetCol}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(targetRow, targetCol);
                if (currentValue !== valueToUse) {
                    this.stateManager.updateCellInternal(targetRow, targetCol, valueToUse);
                    rowChanged = true;
                }
            }

            if (rowChanged) {
                affectedRows.add(targetRow);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
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
        const affectedRows = new Set<number>();

        for (let r = targetRange.start.row!; r <= targetRange.end.row!; r++) {
            let rowChanged = false;
            for (let c = targetRange.start.col!; c <= targetRange.end.col!; c++) {
                // Calculate corresponding source cell using modulo for pattern repetition
                const sourceRowIndex = (r - targetRange.start.row!) % sourceRows;
                const sourceColIndex = (c - targetRange.start.col!) % sourceCols;
                const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex];

                const targetColKey = this.stateManager.getColumnKey(c);
                const targetSchema = this.stateManager.getSchemaForColumn(c);

                // Skip if disabled
                if (this.stateManager.isCellDisabled(r, c)) continue;

                // Handle type conversion if needed
                let valueToUse = valueToPaste;
                if (valueToUse !== null) {
                    valueToUse = this._convertValueForTargetType(valueToPaste, targetSchema);
                    if (valueToUse === null) continue; // Skip if conversion not possible
                }

                // Validate value
                if (!validateInput(valueToUse, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `Paste range to range: Value validation failed for cell ${r},${c}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(r, c);
                if (currentValue !== valueToUse) {
                    this.stateManager.updateCellInternal(r, c, valueToUse);
                    rowChanged = true;
                }
            }
            if (rowChanged) {
                affectedRows.add(r);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
            log('log', this.options.verbose, `Pasted range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
        }
        return changed;
    }

    /** Pastes external 2D string array starting from a single top-left cell with type conversion */
    private _pasteExternalRangeFromTopLeft(startCell: CellCoords, rangeData: string[][]): boolean {
        if (startCell.row === null || startCell.col === null || !rangeData || rangeData.length === 0) {
            return false;
        }
        
        const startRow = startCell.row;
        const startCol = startCell.col;
        const numRowsToPaste = rangeData.length;
        const numColsToPaste = rangeData[0]?.length || 0;
        let changed = false;
        const totalRows = this.stateManager.getData().length;
        const totalCols = this.stateManager.getColumns().length;
        const affectedRows = new Set<number>();

        for (let rOffset = 0; rOffset < numRowsToPaste; rOffset++) {
            const targetRow = startRow + rOffset;
            if (targetRow >= totalRows) break;

            const pastedRowData = rangeData[rOffset];
            let rowChanged = false;

            for (let cOffset = 0; cOffset < numColsToPaste; cOffset++) {
                const targetCol = startCol + cOffset;
                if (targetCol >= totalCols) break;

                const stringValue = pastedRowData[cOffset]; // String from clipboard
                const targetColKey = this.stateManager.getColumnKey(targetCol);
                const targetSchema = this.stateManager.getSchemaForColumn(targetCol);

                if (this.stateManager.isCellDisabled(targetRow, targetCol)) continue;

                // Convert value based on target cell type
                const convertedValue = this._convertValueForTargetType(stringValue, targetSchema);
                if (convertedValue === null) continue; // Skip if conversion not possible

                if (!validateInput(convertedValue, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `External paste range: Value validation failed for cell ${targetRow},${targetCol}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(targetRow, targetCol);
                if (currentValue !== convertedValue) {
                    this.stateManager.updateCellInternal(targetRow, targetCol, convertedValue);
                    rowChanged = true;
                }
            }

            if (rowChanged) {
                affectedRows.add(targetRow);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
            log('log', this.options.verbose, `Pasted external range [${numRowsToPaste}x${numColsToPaste}] starting at ${startRow},${startCol}`);
        }

        return changed;
    }

    /** Pastes external 2D string array into a selected range with type conversion */
    private _pasteExternalRangeToRange(targetRange: { start: CellCoords, end: CellCoords }, sourceRangeData: string[][]): boolean {
        if (!sourceRangeData || sourceRangeData.length === 0) return false;
        const sourceRows = sourceRangeData.length;
        const sourceCols = sourceRangeData[0]?.length || 0;
        if (sourceCols === 0) return false;

        let changed = false;
        const affectedRows = new Set<number>();

        for (let r = targetRange.start.row!; r <= targetRange.end.row!; r++) {
            let rowChanged = false;
            for (let c = targetRange.start.col!; c <= targetRange.end.col!; c++) {
                const sourceRowIndex = (r - targetRange.start.row!) % sourceRows;
                const sourceColIndex = (c - targetRange.start.col!) % sourceCols;
                const stringValue = sourceRangeData[sourceRowIndex][sourceColIndex]; // String from clipboard

                const targetColKey = this.stateManager.getColumnKey(c);
                const targetSchema = this.stateManager.getSchemaForColumn(c);

                if (this.stateManager.isCellDisabled(r, c)) continue;

                // Convert based on target cell type
                const convertedValue = this._convertValueForTargetType(stringValue, targetSchema);
                if (convertedValue === null) continue; // Skip if conversion not possible

                if (!validateInput(convertedValue, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `External paste range->range: Value validation failed for cell ${r},${c}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(r, c);
                if (currentValue !== convertedValue) {
                    this.stateManager.updateCellInternal(r, c, convertedValue);
                    rowChanged = true;
                }
            }
            if (rowChanged) {
                affectedRows.add(r);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
            log('log', this.options.verbose, `Pasted external range pattern into target range [${targetRange.start.row},${targetRange.start.col}] -> [${targetRange.end.row},${targetRange.end.col}]`);
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
        const totalRows = this.stateManager.getData().length;
        const totalCols = this.stateManager.getColumns().length;
        const affectedRows = new Set<number>();

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

                if (!validateInput(valueToPaste, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `Clipboard paste range TL: Value validation failed for cell ${targetRow},${targetCol}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(targetRow, targetCol);
                if (currentValue !== valueToPaste) {
                    this.stateManager.updateCellInternal(targetRow, targetCol, valueToPaste);
                    rowChanged = true;
                }
            }

            if (rowChanged) {
                affectedRows.add(targetRow);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
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
        const affectedRows = new Set<number>();

        for (let r = targetRange.start.row!; r <= targetRange.end.row!; r++) {
            let rowChanged = false;
            for (let c = targetRange.start.col!; c <= targetRange.end.col!; c++) {
                const sourceRowIndex = (r - targetRange.start.row!) % sourceRows;
                const sourceColIndex = (c - targetRange.start.col!) % sourceCols;
                const valueToPaste = sourceRangeData[sourceRowIndex][sourceColIndex]; // String from clipboard

                const targetColKey = this.stateManager.getColumnKey(c);
                const targetSchema = this.stateManager.getSchemaForColumn(c);

                if (this.stateManager.isCellDisabled(r, c)) continue;

                // Convert based on target cell type
                const convertedValue = this._convertValueForTargetType(valueToPaste, targetSchema);
                if (convertedValue === null) continue; // Skip if conversion not possible

                if (!validateInput(convertedValue, targetSchema, targetColKey, this.options.verbose)) {
                    log('warn', this.options.verbose, `External paste range->range: Value validation failed for cell ${r},${c}. Skipping.`);
                    continue;
                }

                const currentValue = this.stateManager.getCellData(r, c);
                if (currentValue !== convertedValue) {
                    this.stateManager.updateCellInternal(r, c, convertedValue);
                    rowChanged = true;
                }
            }
            if (rowChanged) {
                affectedRows.add(r);
                changed = true;
            }
        }

        affectedRows.forEach(r => this.stateManager.updateDisabledStatesForRow(r));

        if (changed) {
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
        const data = this.stateManager.getData();
        let changedAny = false;
        
        if (value === undefined || value === null) {
            log('log', this.options.verbose, "No value to paste to column");
            return false;
        }
        
        // Convert value to correct type for the column
        const convertedValue = this._convertValueForTargetType(value, schemaColumn);
        // Apply to all cells in the column
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            // Skip disabled cells
            if (this.stateManager.isCellDisabled(rowIndex, columnIndex)) continue;
            
            const currentValue = this.stateManager.getCellData(rowIndex, columnIndex);
            if (currentValue !== convertedValue) {
                this.stateManager.updateCellInternal(rowIndex, columnIndex, convertedValue);
                changedAny = true;
            }
        }
        
        // Update disabled states after all changes
        if (changedAny) {
            for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
                this.stateManager.updateDisabledStatesForRow(rowIndex);
            }
            this.renderer.draw();
        }
        
        return changedAny;
    }
}
