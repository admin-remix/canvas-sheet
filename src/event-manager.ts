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

    private resizeTimeout: number | null = null;

    constructor(
        container: HTMLElement,
        canvas: HTMLCanvasElement,
        editingManager: EditingManager,
        interactionManager: InteractionManager,
        stateManager: StateManager,
        dimensionCalculator: DimensionCalculator,
        renderer: Renderer,
        options: RequiredSpreadsheetOptions,
        domManager: DomManager
    ) {
        this.container = container;
        this.canvas = canvas;
        this.editingManager = editingManager;
        this.interactionManager = interactionManager;
        this.stateManager = stateManager;
        this.dimensionCalculator = dimensionCalculator;
        this.renderer = renderer;
        this.options = options;
        this.domManager = domManager;

        // Manually set circular dependency for InteractionManager
        // This should ideally be handled by a dependency injection container
        this.interactionManager.setEditingManager(this.editingManager);
    }

    public bindEvents(): void {
        // Container Events
        this.container.addEventListener('scroll', this._handleScroll.bind(this));

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

        // Editing Manager binds its own internal events (blur, keydown on input/dropdown)
        this.editingManager.bindInternalEvents();
    }

    // --- Event Handlers ---

    private _handleScroll(event: Event): void {
        const target = event.target as HTMLElement;
        this.stateManager.updateScroll(target.scrollTop, target.scrollLeft);
        // Deactivate editor/dropdown immediately on scroll
        this.editingManager.deactivateEditor(false); // Don't save changes on scroll
        this.editingManager.hideDropdown();
        // Recalculate visible range and redraw
        this.dimensionCalculator.calculateVisibleRange();
        this.renderer.draw();
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
        if (this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing()) {
            log('log', this.options.verbose, "Click ignored due to active drag/resize.");
            return;
        }

        const coords = this._getCoordsFromEvent(event);
        const isCellClick = coords && coords.row !== null && coords.col !== null;
        const isRowNumberClick = coords && coords.row !== null && coords.col === null && this._isRowNumberAreaClick(event);
        let redrawNeeded = false;

        // 1. Handle Editor Deactivation
        if (this.editingManager.isEditorActive()) {
            const editor = this.stateManager.getActiveEditor();
            const clickOnActiveEditorCell = isCellClick && coords?.row === editor?.row && coords?.col === editor?.col;
            if (!clickOnActiveEditorCell) {
                // Deactivate if clicking anywhere else. Editor handles its own redraw on deactivate.
                this.editingManager.deactivateEditor(true);
            }
        }
        // 2. Handle Dropdown Hiding (no redraw needed just for hiding)
        else if (this.editingManager.isDropdownVisible()) {
             this.editingManager.hideDropdown();
        }

         // 3. Reset copied cell if needed
        const currentCopied = this.stateManager.getCopiedCell();
        if (currentCopied && !isCellClick) {
            // Clear only if not a cell click
            redrawNeeded = redrawNeeded || this.interactionManager.clearCopiedCell();
        }

        // 4. Handle Row Number Click
        if (isRowNumberClick && coords && coords.row !== null) {
            redrawNeeded = redrawNeeded || this.interactionManager.handleRowNumberClick(coords.row, event.shiftKey, event.ctrlKey || event.metaKey);
            redrawNeeded = redrawNeeded || this.stateManager.setActiveCell(null); // Clear cell selection
        }
        // 5. Handle Cell Click
        else if (isCellClick && coords && coords.row !== null) {
            const currentActive = this.stateManager.getActiveCell();
            if (!currentActive || currentActive.row !== coords.row || currentActive.col !== coords.col) {
                 redrawNeeded = redrawNeeded || this.stateManager.setActiveCell(coords);
                 redrawNeeded = redrawNeeded || this.interactionManager.clearSelections(); // Clear row selection
            }
        }
        // 6. Handle Click Outside Cells/Rows
        else {
             redrawNeeded = redrawNeeded || this.stateManager.setActiveCell(null);
             redrawNeeded = redrawNeeded || this.interactionManager.clearSelections();
        }

        // 7. Final Redraw if any state changed
        if (redrawNeeded) {
            this.renderer.draw();
        }
    }

    private _handleCanvasMouseDown(event: MouseEvent): void {
        // Check for resize handle mousedown first
        const resizeTarget = this.interactionManager.checkResizeHandles(event);
        if (resizeTarget) {
            event.preventDefault();
            event.stopPropagation();
            return; // InteractionManager starts resize
        }

        // Check for fill handle mousedown if a cell is active
        const activeCell = this.stateManager.getActiveCell();
        if (activeCell && activeCell.row !== null && activeCell.col !== null) {
            const fillHandleTarget = this.interactionManager.checkFillHandle(event);
            if (fillHandleTarget) {
                event.preventDefault();
                event.stopPropagation();
                return; // InteractionManager starts fill handle drag
            }
        }

        // If not resizing or dragging fill handle, focus container for subsequent keyboard events
        // _handleClick will handle selection changes
        this.domManager.focusContainer();
    }

    private _handleDocumentMouseMove(event: MouseEvent): void {
        if (this.stateManager.isResizing()) {
            this.interactionManager.handleResizeMouseMove(event);
            // handleResizeMouseMove triggers redraws internally
        } else if (this.stateManager.isDraggingFillHandle()) {
            this.interactionManager.handleFillHandleMouseMove(event);
            // handleFillHandleMouseMove triggers redraws internally
        } else {
            // Update cursor based on hover over resize/fill handles even when not actively dragging
            this.interactionManager.updateCursorStyle(event);
        }
    }

    private _handleDocumentMouseUp(event: MouseEvent): void {
        let redrawNeeded = false;
        if (this.stateManager.isResizing()) {
            this.interactionManager.endResize();
            // No redraw flag needed, resize mouse move handled draws. Final state is set.
        }
        if (this.stateManager.isDraggingFillHandle()) {
            this.interactionManager.endFillHandleDrag(); // This performs the fill and triggers draw internally
             // No redraw flag needed here, endFillHandleDrag calls _performFillDown which draws if changed.
        }

        // Always update cursor style on mouse up
        this.interactionManager.updateCursorStyle(event);

        // Note: Redraws are handled within the resize/drag handlers now or by _performFillDown
    }

    // Handle clicks outside the spreadsheet container
    private _handleGlobalMouseDown(event: MouseEvent): void {
        if (this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing()) return; // Don't interfere

        if (!this.container.contains(event.target as Node)) {
            let needsRedraw = false;
            if (this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible()) {
                // Editor handles its own redraw on deactivate
                this.editingManager.deactivateEditor(true);
            } else {
                // Clear selection state if clicking outside and not editing
                needsRedraw = needsRedraw || this.stateManager.setActiveCell(null);
                needsRedraw = needsRedraw || this.interactionManager.clearSelections();
                needsRedraw = needsRedraw || this.interactionManager.clearCopiedCell();
            }

            if (needsRedraw) {
                this.renderer.draw();
            }
        }
    }

    private _handleDocumentKeyDown(event: KeyboardEvent): void {
        const isCtrl = event.ctrlKey || event.metaKey; // Meta for Mac
        let redrawNeeded = false;

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

        // --- Actions only when editor is INACTIVE ---
        if (this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible()) {
            return; // Let editor handle its events
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (this.stateManager.getSelectedRows().size > 0) {
                redrawNeeded = this.interactionManager.deleteSelectedRows();
                event.preventDefault();
                // deleteSelectedRows handles recalculations internally
            } else if (this.stateManager.getActiveCell()) {
                // TODO: Implement clearing active cell content & return redraw flag
                const activeCell = this.stateManager.getActiveCell();
                if(activeCell && activeCell.row !== null && activeCell.col !== null && !this.stateManager.isCellDisabled(activeCell.row, activeCell.col)){
                    // Example: Set cell value to null
                    // const cleared = this.stateManager.updateCell(activeCell.row, this.stateManager.getColumnKey(activeCell.col), null);
                    // redrawNeeded = cleared;
                    log('log', this.options.verbose, `Delete key on cell ${activeCell.row},${activeCell.col} - clearing not implemented.`);
                }
                event.preventDefault();
            }
        } else if (event.key.startsWith('Arrow')) {
            const activeCell = this.stateManager.getActiveCell();
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
        } else if (event.key === 'Enter' && this.stateManager.getActiveCell()) {
            const activeCell = this.stateManager.getActiveCell();
            if (activeCell && activeCell.row !== null && activeCell.col !== null) {
                if (!this.stateManager.isCellDisabled(activeCell.row, activeCell.col)) {
                    this.editingManager.activateEditor(activeCell.row, activeCell.col);
                    event.preventDefault();
                    // activateEditor handles redraw/focus
                }
            }
        } else if (event.key === 'Tab' && this.stateManager.getActiveCell()) {
            // moveActiveCell handles finding next cell, setting state, and activating editor (which redraws)
            this.interactionManager.moveActiveCell(0, event.shiftKey ? -1 : 1);
            event.preventDefault();
        }

        // Redraw if Delete/Backspace on rows caused a state change
        if (redrawNeeded) {
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

    private _isRowNumberAreaClick(event: MouseEvent): boolean {
        const rect = this.domManager.getCanvasBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        return canvasX < this.options.rowNumberWidth;
    }
}