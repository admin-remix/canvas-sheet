import {
    RequiredSpreadsheetOptions,
    CellCoords
} from './types';
import { EditingManager } from './editing-manager';
import { InteractionManager } from './interaction-manager';
import { StateManager } from './state-manager';
import { DimensionCalculator } from './dimension-calculator';
import { Renderer } from './renderer';
import { log } from './utils';
import { DomManager } from './dom-manager';

export class EventManager {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private editingManager: EditingManager;
    private interactionManager: InteractionManager;
    private stateManager: StateManager;
    private dimensionCalculator: DimensionCalculator;
    private renderer: Renderer;
    private options: RequiredSpreadsheetOptions;
    private domManager: DomManager;

    private hScrollbar: HTMLDivElement;
    private vScrollbar: HTMLDivElement;

    private resizeTimeout: number | null = null;
    private _ignoreNextClick = false; // Flag to ignore click after drag mouseup
    private isCtrl = false;

    constructor(
        container: HTMLElement,
        editingManager: EditingManager,
        interactionManager: InteractionManager,
        stateManager: StateManager,
        dimensionCalculator: DimensionCalculator,
        renderer: Renderer,
        options: RequiredSpreadsheetOptions,
        domManager: DomManager
    ) {
        this.container = container;
        this.editingManager = editingManager;
        this.interactionManager = interactionManager;
        this.stateManager = stateManager;
        this.dimensionCalculator = dimensionCalculator;
        this.renderer = renderer;
        this.options = options;
        this.domManager = domManager;
        this.canvas = this.domManager.getCanvas();
        this.hScrollbar = this.domManager.getHScrollbar();
        this.vScrollbar = this.domManager.getVScrollbar();

        // Manually set circular dependency for InteractionManager
        // This should ideally be handled by a dependency injection container
        this.interactionManager.setEditingManager(this.editingManager);
    }

    public bindEvents(): void {
        // Container Events
        this.container.addEventListener('wheel', this._handleWheel.bind(this));
        this.hScrollbar.addEventListener('scroll', this._handleHScroll.bind(this));
        this.vScrollbar.addEventListener('scroll', this._handleVScroll.bind(this));

        // Canvas Events
        this.canvas.addEventListener('dblclick', this._handleDoubleClick.bind(this));
        this.canvas.addEventListener('click', this._handleClick.bind(this));
        this.canvas.addEventListener('mousedown', this._handleCanvasMouseDown.bind(this));
        // Mouse move handled on document to capture movement outside canvas during drag/resize

        // Document/Window Events
        document.addEventListener('mousemove', this._handleDocumentMouseMove.bind(this));
        document.addEventListener('mouseup', this._handleDocumentMouseUp.bind(this));
        window.addEventListener('resize', this._handleResize.bind(this));
        document.addEventListener('mousedown', this._handleGlobalMouseDown.bind(this), true); // Use capture phase
        document.addEventListener('keydown', this._handleDocumentKeyDown.bind(this));
        document.addEventListener('keyup', this._handleDocumentKeyUp.bind(this));
        // Add listener for the native paste event on the container
        this.container.addEventListener('paste', this._handlePaste.bind(this));

        // Editing Manager binds its own internal events (blur, keydown on input/dropdown)
        this.editingManager.bindInternalEvents();
    }

    // --- Event Handlers ---
    private _handleScroll() {
        // Deactivate editor/dropdown immediately on scroll
        this.editingManager.deactivateEditor(false); // Don't save changes on scroll
        this.editingManager.hideDropdown();
        // Recalculate visible range and redraw
        this.dimensionCalculator.calculateVisibleRange();
        this.renderer.draw();
    }
    private _handleWheel(event: WheelEvent): void {
        const amount = event.deltaY;
        event.preventDefault();
        const { scrollTop, scrollLeft } = this.interactionManager.moveScroll(event.shiftKey ? amount: 0, event.shiftKey ? 0 : amount);
        this.stateManager.updateScroll(scrollTop, scrollLeft);
        this._handleScroll();
    }
    private _handleHScroll(event: Event) {
        const target = event.target as HTMLElement;
        const scrollLeft = target.scrollLeft;
        this.stateManager.updateScroll(this.stateManager.getScrollTop(), scrollLeft);
        this._handleScroll();
    }
    private _handleVScroll(event: Event) {
        const target = event.target as HTMLElement;
        const scrollTop = target.scrollTop;
        this.stateManager.updateScroll(scrollTop, this.stateManager.getScrollLeft());
        this._handleScroll();
    }
    private _handleResize(): void {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = window.setTimeout(() => {
            // Deactivate editor/dropdown before recalculating
            this.editingManager.deactivateEditor(false);
            this.editingManager.hideDropdown();

            this.dimensionCalculator.calculateDimensions(
                this.container.clientWidth,
                this.container.clientHeight
            );
            // Ensure canvas visual size matches recalculated logical size
            this.domManager.updateCanvasSize(
                this.stateManager.getTotalContentWidth(),
                this.stateManager.getTotalContentHeight()
            );
            this.renderer.draw();
            this.resizeTimeout = null;
        }, 100); // Debounce resize event
    }

    private _handleDoubleClick(event: MouseEvent): void {
        if (this.stateManager.isResizing()) {
            log('log', this.options.verbose, "Double click ignored due to active resize.");
            return;
        }

        const coords = this._getCoordsFromEvent(event);
        if (!coords || coords.row === null || coords.col === null) return;

        let redrawNeeded = false;
        // Clear selection/copy state before editing
        redrawNeeded = redrawNeeded || this.interactionManager.clearSelections();
        redrawNeeded = redrawNeeded || this.interactionManager.clearCopiedCell();
        redrawNeeded = redrawNeeded || this.stateManager.setActiveCell(coords); // Set active cell for highlight before editor opens

        if (this.stateManager.isCellDisabled(coords.row, coords.col)) {
            log('log', this.options.verbose, `Edit prevented: Cell ${coords.row},${coords.col} is disabled.`);
            if (redrawNeeded) {
                this.renderer.draw(); // Redraw if selection/copy state changed
            }
            return;
        }

        // Activate the editor
        this.editingManager.activateEditor(coords.row, coords.col);
        // No need to call draw here, activateEditor should trigger redraw if needed
    }

    private _handleClick(event: MouseEvent): void {
        // Ignore click if it should be ignored (e.g. right after drag)
        if (this._ignoreNextClick) {
            this._ignoreNextClick = false;
            return;
        }

        // Ignore clicks if currently dragging the fill handle or resizing
        if (this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing()) {
            log('log', this.options.verbose, "Click ignored due to active fill handle drag or resize.");
            return;
        }

        const coords = this._getCoordsFromEvent(event);
        const isCellClick = coords && coords.row !== null && coords.col !== null;
        const isRowNumberClick = coords && coords.row !== null && coords.col === null && this._isRowNumberAreaClick(event);
        const isHeaderClick = this._isHeaderAreaClick(event);
        let redrawNeeded = false;

        // --- Deactivate Editor/Dropdown (no redraw trigger here) ---
        if (this.editingManager.isEditorActive()) {
            const editor = this.stateManager.getActiveEditor();
            const clickOnActiveEditorCell = isCellClick && coords?.row === editor?.row && coords?.col === editor?.col;
            if (!clickOnActiveEditorCell) {
                this.editingManager.deactivateEditor(true);
            }
        } else if (this.editingManager.isDropdownVisible()) {
             this.editingManager.hideDropdown();
        }

         // --- Handle Selections & Clear Other States ---
        const currentCopied = this.stateManager.isCopyActive(); // Check if any copy state is active

        if (isRowNumberClick && coords && coords.row !== null) {
            const rowsChanged = this.interactionManager.handleRowNumberClick(coords.row, event.shiftKey, event.ctrlKey || event.metaKey);
            // InteractionManager.handleRowNumberClick now handles clearing cell/range state internally
            const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false;
            redrawNeeded = rowsChanged || copyCleared;
        }
        else if (isHeaderClick) {
            const column = this._getColumnFromEvent(event);
            if (column !== null) {
                const columnsChanged = this.interactionManager.handleHeaderClick(column);
                const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false;
                redrawNeeded = columnsChanged || copyCleared;
            }
        }
        else if (isCellClick && coords && coords.row !== null) {
            const cellChanged = this.stateManager.setActiveCell(coords);
            let rowsCleared = false;
            let rangeCleared = false;
            let columnsCleared = false;
            // If cell changed, explicitly clear other selections
            if (cellChanged) {
                 rowsCleared = this.interactionManager.clearSelections();
                 rangeCleared = this.stateManager.clearSelectionRange();
            }
            //const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false;
            redrawNeeded = cellChanged || rowsCleared || rangeCleared;// || copyCleared;
        }
        else {
             // Click outside
             const cellCleared = this.stateManager.setActiveCell(null);
             let rowsCleared = false;
             let rangeCleared = false;
             if (cellCleared) { // If active cell was cleared, clear others too
                 rowsCleared = this.interactionManager.clearSelections();
                 rangeCleared = this.stateManager.clearSelectionRange();
             }
             const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false;
             redrawNeeded = cellCleared || rowsCleared || rangeCleared || copyCleared;
        }

        // Final Redraw
        if (redrawNeeded) {
            this.renderer.draw();
        }
    }

    private _handleCanvasMouseDown(event: MouseEvent): void {
        this._ignoreNextClick = false;
         // Prioritize resize/fill handle detection
        const resizeTarget = this.interactionManager.checkResizeHandles(event);
        if (resizeTarget) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const activeCell = this.stateManager.getActiveCell();
        if (activeCell && activeCell.row !== null && activeCell.col !== null) {
            const fillHandleTarget = this.interactionManager.checkFillHandle(event);
            if (fillHandleTarget) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }

        // If not resizing or dragging fill handle, check for cell click to start selection drag
        const coords = this._getCoordsFromEvent(event);
        if (coords && coords.row !== null && coords.col !== null) {
             // Deactivate editor if clicking on a different cell
            if (this.editingManager.isEditorActive()) {
                 const editor = this.stateManager.getActiveEditor();
                 if (coords.row !== editor?.row || coords.col !== editor?.col) {
                     this.editingManager.deactivateEditor(true);
                 }
             }

            // Start selection drag
            const dragStarted = this.interactionManager.startSelectionDrag(coords);
            // InteractionManager.startSelectionDrag now handles clearing row state internally
            if (dragStarted) {
                this.renderer.draw();
            }
            event.preventDefault();
            this.domManager.focusContainer();
        }
    }

    private _handleDocumentMouseMove(event: MouseEvent): void {
        if (this.stateManager.isResizing()) {
            this.interactionManager.handleResizeMouseMove(event); // Handles redraw
        } else if (this.stateManager.isDraggingFillHandle()) {
            this.interactionManager.handleFillHandleMouseMove(event); // Handles redraw
        } else if (this.stateManager.getIsDraggingSelection()) {
            // Update selection range based on mouse position
            const coords = this._getCoordsFromEvent(event);
            if (coords) {
                const redrawNeeded = this.interactionManager.updateSelectionDrag(coords);
                if (redrawNeeded) {
                    this.renderer.draw();
                }
            }
        } else {
            // Update cursor style for hover
            this.interactionManager.updateCursorStyle(event);
        }
    }

    private _handleDocumentMouseUp(event: MouseEvent): void {
        let wasDraggingSelection = false;
        // Order matters: check drag selection first
        if (this.stateManager.getIsDraggingSelection()) {
            wasDraggingSelection = true;
            this.interactionManager.endSelectionDrag();
        }
        if (this.stateManager.isResizing()) {
            this.interactionManager.endResize();
        }
        if (this.stateManager.isDraggingFillHandle()) {
            this.interactionManager.endFillHandleDrag(); // Handles redraw internally
        }

        // Always update cursor style on mouse up
        this.interactionManager.updateCursorStyle(event);

        // If we just finished a drag selection, ignore the next click event
        if (wasDraggingSelection) {
            this._ignoreNextClick = true;
        }
    }

    // Handle clicks outside the spreadsheet container
    private _handleGlobalMouseDown(event: MouseEvent): void {
        if (this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing() || this.stateManager.getIsDraggingSelection()) return;

        if (!this.container.contains(event.target as Node)) {
            let needsRedraw = false;
            if (this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible()) {
                this.editingManager.deactivateEditor(true);
            } else {
                // Clear all selection state if clicking outside
                const cellCleared = this.stateManager.setActiveCell(null);
                let rowsCleared = false;
                let rangeCleared = false;
                if (cellCleared) {
                     rowsCleared = this.interactionManager.clearSelections();
                     rangeCleared = this.stateManager.clearSelectionRange();
                }
                const copyCleared = this.interactionManager.clearCopiedCell();
                needsRedraw = cellCleared || rowsCleared || rangeCleared || copyCleared;
            }

            if (needsRedraw) {
                this.renderer.draw();
            }
        }
    }

    private _handleDocumentKeyDown(event: KeyboardEvent): void {
        this.isCtrl = event.ctrlKey || event.metaKey;
    }
    private _handleDocumentKeyUp(event: KeyboardEvent): void {
        const isCtrl = this.isCtrl;
        this.isCtrl = false;
        let redrawNeeded = false;

        // --- Actions only when editor is INACTIVE ---
        if (this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible()) {
            return; // Let editor handle its events
        }

        // --- Global Shortcuts ---
        if (isCtrl && event.key === 'c') {
            redrawNeeded = this.interactionManager.copy();
            event.preventDefault();
            if (redrawNeeded) this.renderer.draw();
            return;
        }
        if (isCtrl && event.key === 'v') {
            redrawNeeded = this.interactionManager.paste();
            event.preventDefault();
            if (redrawNeeded) this.renderer.draw();
            return;
        }
        const activeCell = this.stateManager.getActiveCell();
        const isCellDisabled = activeCell && activeCell.row !== null && activeCell.col !== null && this.stateManager.isCellDisabled(activeCell.row, activeCell.col);

        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (this.stateManager.getSelectedRows().size > 0) {
                redrawNeeded = this.interactionManager.deleteSelectedRows();
                event.preventDefault();
                // deleteSelectedRows handles recalculations internally
            } else if (activeCell) {
                // TODO: Implement clearing active cell content & return redraw flag
                if(!isCellDisabled){
                    // Example: Set cell value to null
                    // const cleared = this.stateManager.updateCell(activeCell.row, this.stateManager.getColumnKey(activeCell.col), null);
                    // redrawNeeded = cleared;
                    log('log', this.options.verbose, `Delete key on cell ${activeCell.row},${activeCell.col} - clearing not implemented.`);
                }
                event.preventDefault();
            }
        } else if (event.key.startsWith('Arrow')) {
             if (activeCell) {
                 let rowDelta = 0;
                 let colDelta = 0;
                 if (event.key === 'ArrowUp') rowDelta = -1;
                 else if (event.key === 'ArrowDown') rowDelta = 1;
                 else if (event.key === 'ArrowLeft') colDelta = -1;
                 else if (event.key === 'ArrowRight') colDelta = 1;

                 if (rowDelta !== 0 || colDelta !== 0) {
                     // moveActiveCell handles finding next cell, setting state, and activating editor (which redraws)
                     this.interactionManager.moveActiveCell(rowDelta, colDelta);
                     event.preventDefault();
                 }
             }
        } else if (event.key === 'Enter' && activeCell) {
            if (!isCellDisabled && activeCell.row !== null && activeCell.col !== null) {
                this.editingManager.activateEditor(activeCell.row, activeCell.col);
                // activateEditor handles redraw/focus
                event.preventDefault();
            }
        } else if (event.key === 'Tab' && activeCell) {
            // moveActiveCell handles finding next cell, setting state, and activating editor (which redraws)
            this.interactionManager.moveActiveCell(0, event.shiftKey ? -1 : 1);
            event.preventDefault();
        } else if (!isCtrl && !event.ctrlKey && event.key.length === 1) {
            // user is typing a new value into a cell
            if (activeCell && activeCell.row !== null && activeCell.col !== null && !isCellDisabled) {
                this.editingManager.activateEditor(activeCell.row, activeCell.col, event.key);
            }
        }

        // Redraw if Delete/Backspace on rows caused a state change
        if (redrawNeeded) {
            this.renderer.draw();
        }
    }

    // --- Native Paste Event Handling ---
    private _handlePaste(event: ClipboardEvent): void {
        // Only handle paste if editor isn't active and clipboard data exists
        if (this.editingManager.isEditorActive()) return;
        if (!event.clipboardData) return;

        const textData = event.clipboardData.getData('text/plain');
        if (!textData) return;

        if(this.interactionManager.paste()) {
            event.preventDefault();
            this.renderer.draw();
            return;
        }

        const activeCell = this.stateManager.getActiveCell();
        const selectionRange = this.stateManager.getNormalizedSelectionRange();
        const selectedColumn = this.stateManager.getSelectedColumn();
        
        // Check for selected column paste - this takes precedence
        if (selectedColumn !== null) {
            // For external paste to column, we'll just use the first value from the clipboard
            const value = textData.split(/\r\n|\n|\r/)[0].split('\t')[0];
            if (value) {
                log('log', this.options.verbose, "Handling column paste from clipboard");
                event.preventDefault();
                
                // Convert and paste using the interaction manager
                const changed = this.interactionManager.pasteToColumnExternal(selectedColumn, value);
                if (changed) {
                    this.renderer.draw();
                }
            }
            return;
        }
        
        const targetRange = selectionRange;
        const targetCell = (!targetRange && activeCell) ? activeCell : null;

        if (!targetRange && !targetCell) {
            log('log', this.options.verbose, "Clipboard paste ignored: No target cell or range selected.");
            return;
        }

        log('log', this.options.verbose, "Handling native paste event.");
        event.preventDefault(); // Prevent browser's default paste action

        let changed = false;

        // Attempt to parse text data into a 2D array (assuming TSV)
        const parsedRows = textData.split(/\r\n|\n|\r/).map(row => row.split('\t'));
        const isSingleValuePaste = parsedRows.length === 1 && parsedRows[0].length === 1;

        if (targetRange) {
            // Paste to Range (repeat pattern of parsed data)
            changed = this.interactionManager.pasteRangeToRangeExternal(targetRange, parsedRows);
        } else if (targetCell && targetCell.row !== null && targetCell.col !== null) {
            if (isSingleValuePaste) {
                 // Paste single text value to the active cell (check type)
                 changed = this.interactionManager.pasteSingleValueExternal(targetCell, parsedRows[0][0]);
            } else {
                 // Paste multi-line/tabbed text starting from the active cell
                 changed = this.interactionManager.pasteRangeFromTopLeftExternal(targetCell, parsedRows);
            }
        }

        if (changed) {
            this.renderer.draw();
        }
    }

    // --- Helper Methods ---

    private _getCoordsFromEvent(event: MouseEvent): CellCoords | null {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        const contentX = canvasX + this.stateManager.getScrollLeft();
        const contentY = canvasY + this.stateManager.getScrollTop();
        const { headerHeight, rowNumberWidth } = this.options;
        // Get dimensions directly from state/calculator as needed
        const dataLength = this.stateManager.getData().length; // More efficient than getData()
        const columns = this.stateManager.getColumns();
        const rowHeights = this.stateManager.getRowHeights();
        const columnWidths = this.stateManager.getColumnWidths();

        let targetRow: number | null = null;
        let targetCol: number | null = null;

        // Find Row
        if (contentY >= headerHeight) {
            let currentY = headerHeight;
            for (let i = 0; i < dataLength; i++) { // Use cached length
                const rowHeight = rowHeights[i] || this.options.defaultRowHeight;
                if (contentY >= currentY && contentY < currentY + rowHeight) {
                    targetRow = i;
                    break;
                }
                currentY += rowHeight;
                if (currentY > contentY) break;
            }
        }

        // Find Column (only if a row was found)
        if (targetRow !== null) {
            if (contentX >= rowNumberWidth) {
                let currentX = rowNumberWidth;
                for (let j = 0; j < columns.length; j++) {
                    const colWidth = columnWidths[j] || this.options.defaultColumnWidth;
                    if (contentX >= currentX && contentX < currentX + colWidth) {
                        targetCol = j;
                        break;
                    }
                    currentX += colWidth;
                    if (currentX > contentX) break;
                }
            } else {
                targetCol = null; // Click was in row number area
            }
        } else {
            targetRow = null; // Ensure row is null if clicked above data area
            targetCol = null;
        }

        if (targetRow === null && targetCol === null && contentX > rowNumberWidth && contentY < headerHeight) {
             // Clicked in header area, but not on resize handles (handled in mousedown)
             // Treat as no specific cell coordinate
             return null;
        }
        if (targetRow === null && targetCol === null && contentX < rowNumberWidth && contentY < headerHeight){
             // Clicked in corner box
             return null;
        }


        // If targetRow is valid, return coords, otherwise null
        return targetRow !== null ? { row: targetRow, col: targetCol } : null;
    }

    private _getColumnFromEvent(event: MouseEvent): number | null {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const { rowNumberWidth } = this.options;
        const columns = this.stateManager.getColumns();
        const columnWidths = this.stateManager.getColumnWidths();

        if (canvasX < rowNumberWidth) {
            return null; // Not in the header area
        }

        let currentX = rowNumberWidth;
        for (let j = 0; j < columns.length; j++) {
            const colWidth = columnWidths[j] || this.options.defaultColumnWidth;
            if (canvasX >= currentX && canvasX < currentX + colWidth) {
                return j;
            }
            currentX += colWidth;
        }

        return null; // No column found
    }

    private _isRowNumberAreaClick(event: MouseEvent): boolean {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        return canvasX < this.options.rowNumberWidth;
    }

    private _isHeaderAreaClick(event: MouseEvent): boolean {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const canvasY = event.clientY - rect.top;
        return canvasY < this.options.headerHeight;
    }
}