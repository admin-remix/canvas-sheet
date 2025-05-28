import {
  RequiredSpreadsheetOptions,
  CellCoords,
  ValidationError,
  CellBounds,
} from "./types";
import { EditingManager } from "./editing-manager";
import { InteractionManager } from "./interaction-manager";
import { StateManager } from "./state-manager";
import { DimensionCalculator } from "./dimension-calculator";
import { Renderer } from "./renderer";
import { log } from "./utils";
import { DomManager } from "./dom-manager";
import { ERROR_FIELD_PREFIX } from "./config";
import { Spreadsheet } from './index'; 

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
  private spreadsheet: Spreadsheet; 

  private hScrollbar: HTMLDivElement;
  private vScrollbar: HTMLDivElement;
  private resizeTimeout: number | null = null;
  private _ignoreNextClick = false;
  private isCtrl = false;
  private lastTouchX: number | null = null;
  private lastTouchY: number | null = null;
  private isTouching: boolean = false;
  private touchVelocityX: number = 0;
  private touchVelocityY: number = 0;
  private lastTouchTime: number = 0;
  private kineticScrollInterval: number | null = null;
  private redrawOnKeyUp = false;

  constructor(
    container: HTMLElement,
    editingManager: EditingManager,
    interactionManager: InteractionManager,
    stateManager: StateManager,
    dimensionCalculator: DimensionCalculator,
    renderer: Renderer,
    options: RequiredSpreadsheetOptions,
    domManager: DomManager,
    spreadsheet: Spreadsheet 
  ) {
    this.container = container;
    this.editingManager = editingManager;
    this.interactionManager = interactionManager;
    this.stateManager = stateManager;
    this.dimensionCalculator = dimensionCalculator;
    this.renderer = renderer;
    this.options = options;
    this.domManager = domManager;
    this.spreadsheet = spreadsheet; 
    this.canvas = this.domManager.getCanvas();
    this.hScrollbar = this.domManager.getHScrollbar();
    this.vScrollbar = this.domManager.getVScrollbar();
    this.interactionManager.setEditingManager(this.editingManager);
  }

  public bindEvents(): void {
    this.container.addEventListener("wheel", this._handleWheel.bind(this));
    this.hScrollbar.addEventListener("scroll", this._handleHScroll.bind(this));
    this.vScrollbar.addEventListener("scroll", this._handleVScroll.bind(this));
    this.canvas.addEventListener("dblclick",this._handleDoubleClick.bind(this));
    this.canvas.addEventListener("click", this._handleClick.bind(this));
    this.canvas.addEventListener("mousedown",this._handleCanvasMouseDown.bind(this));
    this.canvas.addEventListener("contextmenu",this._handleCanvasContextMenu.bind(this));
    document.addEventListener("mousemove",this._handleDocumentMouseMove.bind(this));
    document.addEventListener("mouseup",this._handleDocumentMouseUp.bind(this));
    new ResizeObserver(() => { this._handleResize(); }).observe(this.container);
    document.addEventListener("mousedown",this._handleGlobalMouseDown.bind(this),true);
    document.addEventListener("keydown",this._handleDocumentKeyDown.bind(this));
    document.addEventListener("keyup", this._handleDocumentKeyUp.bind(this)); 
    this.container.addEventListener("paste", this._handlePaste.bind(this));
    this.canvas.addEventListener("touchstart",this._handleTouchStart.bind(this));
    this.canvas.addEventListener("touchmove", this._handleTouchMove.bind(this));
    this.canvas.addEventListener("touchend", this._handleTouchEnd.bind(this));
    this.canvas.addEventListener("touchcancel",this._handleTouchEnd.bind(this));
    this.editingManager.bindInternalEvents();
    window.addEventListener("keydown", (event) => {
      if (event.key.startsWith("Arrow") && document.activeElement === this.container) {
        const activeCell = this.stateManager.getActiveCell();
        const isActiveCellValid = activeCell && activeCell.row !== null && activeCell.col !== null;
        if (activeCell && isActiveCellValid) { event.preventDefault(); }
      }
    });
  }

  private _handleDocumentKeyDown(event: KeyboardEvent): void {
    // Undo/Redo logic has been REMOVED from this method.
       
    if (event.repeat && ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape", "Delete"].includes(event.key)) {
      event.preventDefault();
      return;
    }

    if (event.ctrlKey || event.metaKey) {
        this.isCtrl = true; 
    } else {
        this.isCtrl = false; 
    }

    if (this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible()) {
      return; 
    }
       
    const activeCell = this.stateManager.getActiveCell();
    let redrawNeeded = false;
    if (event.key === "Tab" && activeCell) {
      if (document.activeElement !== this.container && !this.container.contains(document.activeElement as Node)) {
        event.preventDefault();
        this.domManager.focusContainer();
      }
      redrawNeeded = this.interactionManager.moveActiveCell(0, event.shiftKey ? -1 : 1);
      if (redrawNeeded) {
        this.interactionManager.clearSelections();
        this.stateManager.clearSelectionRange();
      }
      event.preventDefault();
    }
    this.redrawOnKeyUp = redrawNeeded;
  }

  private _handleDocumentKeyUp(event: KeyboardEvent): void {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;

    if (!this.editingManager.isEditorActive() && !this.editingManager.isDropdownVisible()) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) { 
          this.spreadsheet.redo();
        } else { 
          this.spreadsheet.undo();
        }
        // this.isCtrl = isCtrlOrMeta; // isCtrl should reflect the current state of modifier keys
        return; 
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.spreadsheet.redo(); 
        // this.isCtrl = isCtrlOrMeta; // isCtrl should reflect the current state of modifier keys
        return; 
      }
    }
    
    // Update isCtrl based on actual key state at keyup
    if (!(event.ctrlKey || event.metaKey) && this.isCtrl) {
        this.isCtrl = false;
    }


    let redrawNeeded = this.redrawOnKeyUp;
    let resizeNeeded = false;
    let focusBoundsAfterResize: CellBounds | null = null;

    if (this.redrawOnKeyUp) this.redrawOnKeyUp = false;

    if ( this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible() ) {
      if (redrawNeeded) this.renderer.draw();
      return; 
    }
    
    if (this.isCtrl && event.key.toLowerCase() === "c") { // Use current this.isCtrl state
      redrawNeeded = this.interactionManager.copy();
      event.preventDefault();
      if (redrawNeeded) this.renderer.draw();
      return;
    }
    if (this.isCtrl && event.key.toLowerCase() === "v") { // Use current this.isCtrl state
      redrawNeeded = this.interactionManager.paste();
      event.preventDefault();
      if (redrawNeeded) this.redraw(true);
      return;
    }

    const activeCell = this.stateManager.getActiveCell();
    const isActiveCellValid = activeCell && activeCell.row !== null && activeCell.col !== null;
    const isCellDisabled = isActiveCellValid && this.stateManager.isCellDisabled(activeCell.row!, activeCell.col!);

    if (event.key === "Delete" || event.key === "Backspace") {
      const selectedColumn = this.stateManager.getSelectedColumn();
      if (this.stateManager.getSelectedRows().size > 0) {
        const selectedRows = this.stateManager.getSelectedRows();
        const lowestRowIndex = Math.min(...Array.from(selectedRows.values()));
        focusBoundsAfterResize = this.interactionManager.findAdjacentCellByRowIndex(lowestRowIndex);
        resizeNeeded = this.interactionManager.deleteSelectedRows();
        event.preventDefault();
      } else if (isActiveCellValid) {
        const { row, col } = activeCell;
        const colKey = this.stateManager.getColumnKey(col!);
        if (!isCellDisabled) {
          const currentValue = this.stateManager.getCellData(row!, col!);
          try {
            const cleared = this.stateManager.updateCell( row!, colKey, null, true ); 
            redrawNeeded = cleared;
          } catch (error: unknown) {
            if (error instanceof ValidationError) {
              redrawNeeded = true;
              if (error.errorType === "required" && !currentValue) {
                this.stateManager.updateCell( row!, `${ERROR_FIELD_PREFIX}${colKey}`, error.message );
              } else {
                this.renderer.setTemporaryErrors([ { row: row!, col: col!, error: error.message }, ]);
              }
            }
          }
        }
        event.preventDefault();
      } else if ( event.key === "Delete" && selectedColumn !== null && this.stateManager.getSchemaForColumn(selectedColumn)?.removable ) {
        if (this.options.onColumnDelete) {
          try { this.options.onColumnDelete( selectedColumn, this.stateManager.getSchemaForColumn(selectedColumn)! ); } 
          catch (error: unknown) { log("warn", this.options.verbose, error); }
          return;
        } else {
          if (this.stateManager.getColumns().length > 1) {
            focusBoundsAfterResize = this.interactionManager.findAdjacentCellByColumnIndex( selectedColumn );
          }
          const columnToDelete = this.stateManager.getColumnKey(selectedColumn);
          this.stateManager.removeColumn(selectedColumn);
          redrawNeeded = true;
          resizeNeeded = true;
          try { this.options.onColumnDeleted?.(columnToDelete); } 
          catch (error) { log( "error", this.options.verbose, `Error calling onColumnDeleted: ${error}` ); }
        }
        event.preventDefault();
      }
    } else if (event.key.startsWith("Arrow")) {
      if (activeCell && isActiveCellValid) {
        let rowDelta = 0; let colDelta = 0;
        if (event.key === "ArrowUp") rowDelta = -1;
        else if (event.key === "ArrowDown") rowDelta = 1;
        else if (event.key === "ArrowLeft") colDelta = -1;
        else if (event.key === "ArrowRight") colDelta = 1;

        if (rowDelta !== 0 || colDelta !== 0) {
          redrawNeeded = this.interactionManager.moveActiveCell( rowDelta, colDelta, false );
          if (redrawNeeded) {
            this.interactionManager.clearSelections();
            this.stateManager.clearSelectionRange();
          }
          event.preventDefault();
        }
      }
    } else if (event.key === "Enter" && activeCell) {
      if ( !isCellDisabled && activeCell.row !== null && activeCell.col !== null ) {
        this.editingManager.activateEditor(activeCell.row, activeCell.col);
        event.preventDefault();
      }
    } else if ( event.key !== "Tab" && !isCtrlOrMeta && event.key.length === 1 ) { // was !this.isCtrl
      if ( activeCell && activeCell.row !== null && activeCell.col !== null && !isCellDisabled ) {
        this.editingManager.activateEditor( activeCell.row, activeCell.col, event.key );
      }
    }
    if (resizeNeeded) { this.interactionManager.triggerCustomEvent( "resize", focusBoundsAfterResize ); } 
    else if (redrawNeeded) { this.renderer.draw(); }
  }
  private redraw(shouldAutoResize = false) { if (shouldAutoResize && this.options.autoResizeRowHeight) { this.interactionManager.resizeRowsForColumn(); } else { this.renderer.draw(); } }
  private _handleScroll() { this.interactionManager.onScroll(); }
  private _handleWheel(event: WheelEvent): void { const amount = event.deltaY; const horizontal = event.shiftKey; if (!this.interactionManager.canScrollMore(amount, !horizontal)) { return; } event.preventDefault(); this.interactionManager.moveScroll( horizontal ? amount : 0, horizontal ? 0 : amount ); this._handleScroll(); }
  private _handleHScroll(event: Event) { const target = event.target as HTMLElement; const scrollLeft = target.scrollLeft; this.stateManager.updateScroll( this.stateManager.getScrollTop(), scrollLeft ); this._handleScroll(); }
  private _handleVScroll(event: Event) { const target = event.target as HTMLElement; const scrollTop = target.scrollTop; this.stateManager.updateScroll( scrollTop, this.stateManager.getScrollLeft() ); this._handleScroll(); }
  private _handleResize(): void { if (this.resizeTimeout) { clearTimeout(this.resizeTimeout); } this.resizeTimeout = window.setTimeout(() => { this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown(); this.dimensionCalculator.calculateDimensions( this.container.clientWidth, this.container.clientHeight ); this.domManager.updateCanvasSize( this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight() ); this.renderer.draw(); this.resizeTimeout = null; }, 100); }
  private _handleDoubleClick(event: MouseEvent): void { if (this.stateManager.isResizing()) { return; } const coords = this._getCoordsFromEvent(event); if (!coords || coords.row === null || coords.col === null) return; let redrawNeeded = false; redrawNeeded = redrawNeeded || this.interactionManager.clearSelections(); redrawNeeded = redrawNeeded || this.interactionManager.clearCopiedCell(); redrawNeeded = redrawNeeded || this.stateManager.setActiveCell(coords); if (this.stateManager.isCellDisabled(coords.row, coords.col)) { if (redrawNeeded) { this.renderer.draw(); } return; } this.editingManager.activateEditor(coords.row, coords.col); }
  private _handleClick(event: MouseEvent): void { if (this._ignoreNextClick) { this._ignoreNextClick = false; return; } if ( this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing() ) { return; } const coords = this._getCoordsFromEvent(event); const isCellClick = coords && coords.row !== null && coords.col !== null; const isRowNumberClick = coords && coords.row !== null && coords.col === null && this._isRowNumberAreaClick(event); const isHeaderClick = this._isHeaderAreaClick(event); let redrawNeeded = false; if (this.editingManager.isEditorActive()) { const editor = this.stateManager.getActiveEditor(); const clickOnActiveEditorCell = isCellClick && coords?.row === editor?.row && coords?.col === editor?.col; if (!clickOnActiveEditorCell) { this.editingManager.deactivateEditor(true); } } else if (this.editingManager.isDropdownVisible()) { this.editingManager.hideDropdown(); } const currentCopied = this.stateManager.isCopyActive(); if (isRowNumberClick && coords && coords.row !== null) { const rowsChanged = this.interactionManager.handleRowNumberClick( coords.row, event.shiftKey, event.ctrlKey || event.metaKey ); const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false; redrawNeeded = rowsChanged || copyCleared; } else if (isHeaderClick) { const column = this._getColumnFromEvent(event); if (column !== null) { const columnsChanged = this.interactionManager.handleHeaderClick(column); const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false; redrawNeeded = columnsChanged || copyCleared; } } else { const cellCleared = this.stateManager.setActiveCell(null); let rowsCleared = false; let rangeCleared = false; if (cellCleared) { rowsCleared = this.interactionManager.clearSelections(); rangeCleared = this.stateManager.clearSelectionRange(); } const copyCleared = currentCopied ? this.interactionManager.clearCopiedCell() : false; redrawNeeded = cellCleared || rowsCleared || rangeCleared || copyCleared; } if (redrawNeeded) { this.renderer.draw(); } }
  private _handleCanvasContextMenu(event: MouseEvent): void { event.preventDefault(); const coords = this._getCoordsFromEvent(event); const isCellClick = coords && coords.row !== null && coords.col !== null; const isRowNumberClick = coords && coords.row !== null && coords.col === null && this._isRowNumberAreaClick(event); const isHeaderClick = this._isHeaderAreaClick(event); let redrawNeeded = false; if (isCellClick) { try { this.options.onCellContextMenu?.({ rowIndex: coords?.row!, colKey: this.stateManager.getColumnKey(coords?.col!), rowData: this.stateManager.getRowData(coords?.row!) || {}, x: event.clientX, y: event.clientY, }); } catch (error: unknown) { log("warn", this.options.verbose, error); } } else if (isRowNumberClick) { redrawNeeded = this.interactionManager.handleRowNumberClick( coords?.row!, event.shiftKey, event.ctrlKey || event.metaKey ); try { this.options.onRowNumberContextMenu?.({ rowIndex: coords?.row!, x: event.clientX, y: event.clientY, }); } catch (error: unknown) { log("warn", this.options.verbose, error); } } else if (isHeaderClick && coords?.col !== null) { redrawNeeded = this.interactionManager.handleHeaderClick(coords?.col!); try { this.options.onColumnHeaderContextMenu?.({ colIndex: coords?.col!, x: event.clientX, y: event.clientY, }); } catch (error: unknown) { log("warn", this.options.verbose, error); } } if (redrawNeeded) { this.renderer.draw(); } }
  private _handleCanvasMouseDown(event: MouseEvent): void { this._ignoreNextClick = false; const resizeTarget = this.interactionManager.checkResizeHandles(event); if (resizeTarget) { event.preventDefault(); event.stopPropagation(); return; } const activeCell = this.stateManager.getActiveCell(); let hasActiveCell = false; if (activeCell && activeCell.row !== null && activeCell.col !== null) { hasActiveCell = true; const fillHandleTarget = this.interactionManager.checkFillHandle(event); if (fillHandleTarget) { event.preventDefault(); event.stopPropagation(); return; } } const coords = this._getCoordsFromEvent(event); if (coords && coords.row !== null && coords.col !== null) { if (this.editingManager.isEditorActive()) { const editor = this.stateManager.getActiveEditor(); if (coords.row !== editor?.row || coords.col !== editor?.col) { this.editingManager.deactivateEditor(true); } } if ( event.shiftKey && hasActiveCell && (coords.row !== activeCell?.row || coords.col !== activeCell?.col) ) { event.preventDefault(); this.domManager.focusContainer(); return; } const dragStarted = this.interactionManager.startSelectionDrag(coords); if (dragStarted) { this.renderer.draw(); } event.preventDefault(); this.domManager.focusContainer(); } }
  private _handleDocumentMouseMove(event: MouseEvent): void { if (this.stateManager.isResizing()) { this.interactionManager.handleResizeMouseMove(event); } else if (this.stateManager.isDraggingFillHandle()) { this.interactionManager.handleFillHandleMouseMove(event); this._ignoreNextClick = true; } else if (this.stateManager.getIsDraggingSelection()) { const coords = this._getCoordsFromEvent(event); if (coords) { const redrawNeeded = this.interactionManager.updateSelectionDrag(coords); if (redrawNeeded) { this.renderer.draw(); } } } else { this.interactionManager.updateCursorStyle(event); } }
  private _handleDocumentMouseUp(event: MouseEvent): void { let shouldIgnoreNextClick = false; const selectedCell = this.stateManager.getActiveCell(); if (this.stateManager.getIsDraggingSelection()) { shouldIgnoreNextClick = true; this.interactionManager.endSelectionDrag(); } else if ( event.shiftKey && selectedCell && selectedCell.row !== null && selectedCell.col !== null ) { const coords = this._getCoordsFromEvent(event); if (coords && coords.row !== null && coords.col !== null) { this.interactionManager.startSelectionDrag(selectedCell); this.interactionManager.updateSelectionDrag(coords); this.interactionManager.endSelectionDrag(); this.renderer.draw(); shouldIgnoreNextClick = true; } } if (this.stateManager.isResizing()) { this.interactionManager.endResize(); shouldIgnoreNextClick = true; } if (this.stateManager.isDraggingFillHandle()) { this.interactionManager.endFillHandleDrag(); } this.interactionManager.updateCursorStyle(event); if (shouldIgnoreNextClick) { this._ignoreNextClick = true; } }
  private _handleGlobalMouseDown(event: MouseEvent): void { if ( this.stateManager.isDraggingFillHandle() || this.stateManager.isResizing() || this.stateManager.getIsDraggingSelection() ) return; if (!this.container.contains(event.target as Node)) { let needsRedraw = false; if ( this.editingManager.isEditorActive(true) || this.editingManager.isDropdownVisible() ) { if (this.domManager.checkEventBoundInDropdown(event)) { return; } this.editingManager.deactivateEditor(true); } else { const cellCleared = this.stateManager.setActiveCell(null); let rowsCleared = false; let rangeCleared = false; if (cellCleared) { rowsCleared = this.interactionManager.clearSelections(); rangeCleared = this.stateManager.clearSelectionRange(); } const copyCleared = this.interactionManager.clearCopiedCell(); needsRedraw = cellCleared || rowsCleared || rangeCleared || copyCleared; } if (needsRedraw) { this.renderer.draw(); } } }
  private _handleDocumentKeyUp(event: KeyboardEvent): void { const isCtrl = this.isCtrl; if (!(event.ctrlKey || event.metaKey)) { this.isCtrl = false; } let redrawNeeded = this.redrawOnKeyUp; let resizeNeeded = false; let focusBoundsAfterResize: CellBounds | null = null; if (this.redrawOnKeyUp) this.redrawOnKeyUp = false; if ( this.editingManager.isEditorActive() || this.editingManager.isDropdownVisible() ) { if (redrawNeeded) this.renderer.draw(); return; } if (isCtrl && event.key.toLowerCase() === "c") { redrawNeeded = this.interactionManager.copy(); event.preventDefault(); if (redrawNeeded) this.renderer.draw(); return; } if (isCtrl && event.key.toLowerCase() === "v") { redrawNeeded = this.interactionManager.paste(); event.preventDefault(); if (redrawNeeded) this.redraw(true); return; } const activeCell = this.stateManager.getActiveCell(); const isActiveCellValid = activeCell && activeCell.row !== null && activeCell.col !== null; const isCellDisabled = isActiveCellValid && this.stateManager.isCellDisabled(activeCell.row!, activeCell.col!); if (event.key === "Delete") { const selectedColumn = this.stateManager.getSelectedColumn(); if (this.stateManager.getSelectedRows().size > 0) { const selectedRows = this.stateManager.getSelectedRows(); const lowestRowIndex = Math.min(...Array.from(selectedRows.values())); focusBoundsAfterResize = this.interactionManager.findAdjacentCellByRowIndex(lowestRowIndex); resizeNeeded = this.interactionManager.deleteSelectedRows(); event.preventDefault(); } else if (isActiveCellValid) { const { row, col } = activeCell; const colKey = this.stateManager.getColumnKey(col!); if (!isCellDisabled) { const currentValue = this.stateManager.getCellData(row!, col!); try { const cleared = this.stateManager.updateCell( row!, colKey, null, true ); redrawNeeded = cleared; } catch (error: unknown) { if (error instanceof ValidationError) { redrawNeeded = true; if (error.errorType === "required" && !currentValue) { this.stateManager.updateCell( row!, `${ERROR_FIELD_PREFIX}${colKey}`, error.message ); } else { this.renderer.setTemporaryErrors([ { row: row!, col: col!, error: error.message }, ]); } } } } event.preventDefault(); } else if ( event.key === "Delete" && selectedColumn !== null && this.stateManager.getSchemaForColumn(selectedColumn)?.removable ) { if (this.options.onColumnDelete) { try { this.options.onColumnDelete( selectedColumn, this.stateManager.getSchemaForColumn(selectedColumn)! ); } catch (error: unknown) { log("warn", this.options.verbose, error); } return; } else { if (this.stateManager.getColumns().length > 1) { focusBoundsAfterResize = this.interactionManager.findAdjacentCellByColumnIndex( selectedColumn ); } const columnToDelete = this.stateManager.getColumnKey(selectedColumn); this.stateManager.removeColumn(selectedColumn); redrawNeeded = true; resizeNeeded = true; try { this.options.onColumnDeleted?.(columnToDelete); } catch (error) { log( "error", this.options.verbose, `Error calling onColumnDeleted: ${error}` ); } } event.preventDefault(); } } else if (event.key.startsWith("Arrow")) { if (activeCell && isActiveCellValid) { let rowDelta = 0; let colDelta = 0; if (event.key === "ArrowUp") rowDelta = -1; else if (event.key === "ArrowDown") rowDelta = 1; else if (event.key === "ArrowLeft") colDelta = -1; else if (event.key === "ArrowRight") colDelta = 1; if (rowDelta !== 0 || colDelta !== 0) { redrawNeeded = this.interactionManager.moveActiveCell( rowDelta, colDelta, false ); if (redrawNeeded) { this.interactionManager.clearSelections(); this.stateManager.clearSelectionRange(); } event.preventDefault(); } } } else if (event.key === "Enter" && activeCell) { if ( !isCellDisabled && activeCell.row !== null && activeCell.col !== null ) { this.editingManager.activateEditor(activeCell.row, activeCell.col); event.preventDefault(); } } else if ( event.key !== "Tab" && !isCtrl && !(event.ctrlKey || event.metaKey) && event.key.length === 1 ) { if ( activeCell && activeCell.row !== null && activeCell.col !== null && !isCellDisabled ) { this.editingManager.activateEditor( activeCell.row, activeCell.col, event.key ); } } if (resizeNeeded) { this.interactionManager.triggerCustomEvent( "resize", focusBoundsAfterResize ); } else if (redrawNeeded) { this.renderer.draw(); } }
  private _handlePaste(event: ClipboardEvent): void { if (this.editingManager.isEditorActive()) return; if (!event.clipboardData) return; const textData = event.clipboardData.getData("text/plain"); if (!textData) return; if (this.interactionManager.paste()) { event.preventDefault(); this.redraw(true); return; } const activeCell = this.stateManager.getActiveCell(); const selectionRange = this.stateManager.getNormalizedSelectionRange(); const selectedColumn = this.stateManager.getSelectedColumn(); if (selectedColumn !== null) { const value = textData.split(/
|
|/)[0].split("	")[0]; if (value) { event.preventDefault(); const changed = this.interactionManager.pasteToColumnExternal( selectedColumn, value ); if (changed) { this.redraw(true); } } return; } const targetRange = selectionRange; const targetCell = !targetRange && activeCell ? activeCell : null; if (!targetRange && !targetCell) { return; } event.preventDefault(); let changed = false; const parsedRows = textData .split(/
|
|/) .map((row) => row.split("	")); const isSingleValuePaste = parsedRows.length === 1 && parsedRows[0].length === 1; if (targetRange) { changed = this.interactionManager.pasteRangeToRangeExternal( targetRange, parsedRows ); } else if ( targetCell && targetCell.row !== null && targetCell.col !== null ) { if (isSingleValuePaste) { changed = this.interactionManager.pasteSingleValueExternal( targetCell, parsedRows[0][0] ); } else { changed = this.interactionManager.pasteRangeFromTopLeftExternal( targetCell, parsedRows ); } } if (changed) { this.redraw(true); } }
  private _getCoordsFromEvent(event: MouseEvent): CellCoords | null { const rect = this.domManager.getCanvasBoundingClientRect(); const canvasX = event.clientX - rect.left; const canvasY = event.clientY - rect.top; const { headerHeight, rowNumberWidth, defaultRowHeight, defaultColumnWidth, } = this.options; let contentX: number; let contentY: number; if (canvasX >= rowNumberWidth && canvasY >= headerHeight) { contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); contentY = canvasY - headerHeight + this.stateManager.getScrollTop(); } else if (canvasY < headerHeight && canvasX >= rowNumberWidth) { contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); contentY = canvasY; } else if (canvasX < rowNumberWidth && canvasY >= headerHeight) { contentX = canvasX; contentY = canvasY - headerHeight + this.stateManager.getScrollTop(); } else { contentX = canvasX; contentY = canvasY; } const dataLength = this.stateManager.dataLength; const columns = this.stateManager.getColumns(); const rowHeights = this.stateManager.getRowHeights(); const columnWidths = this.stateManager.getColumnWidths(); let targetRow: number | null = null; let targetCol: number | null = null; if (canvasY >= headerHeight) { let currentY = 0; for (let i = 0; i < dataLength; i++) { const rowHeight = rowHeights.get(i) || defaultRowHeight; if (contentY >= currentY && contentY < currentY + rowHeight) { targetRow = i; break; } currentY += rowHeight; if (currentY > contentY) break; } } if (canvasX >= rowNumberWidth) { let currentX = 0; for (let j = 0; j < columns.length; j++) { const colWidth = columnWidths.get(j) || defaultColumnWidth; if (contentX >= currentX && contentX < currentX + colWidth) { targetCol = j; break; } currentX += colWidth; if (currentX > contentX) break; } } if (canvasY < headerHeight && canvasX < rowNumberWidth) { return null; } return { row: targetRow, col: targetCol }; }
  private _getColumnFromEvent(event: MouseEvent): number | null { const rect = this.domManager.getCanvasBoundingClientRect(); const canvasX = event.clientX - rect.left; const { rowNumberWidth, defaultColumnWidth } = this.options; if (canvasX < rowNumberWidth) { return null; } const contentX = canvasX - rowNumberWidth + this.stateManager.getScrollLeft(); const columns = this.stateManager.getColumns(); const columnWidths = this.stateManager.getColumnWidths(); let currentX = 0; for (let j = 0; j < columns.length; j++) { const colWidth = columnWidths.get(j) || defaultColumnWidth; if (contentX >= currentX && contentX < currentX + colWidth) { return j; } currentX += colWidth; } return null; }
  private _isRowNumberAreaClick(event: MouseEvent): boolean { const rect = this.domManager.getCanvasBoundingClientRect(); const canvasX = event.clientX - rect.left; return canvasX < this.options.rowNumberWidth; }
  private _isHeaderAreaClick(event: MouseEvent): boolean { const rect = this.domManager.getCanvasBoundingClientRect(); const canvasY = event.clientY - rect.top; return canvasY < this.options.headerHeight; }
  private _handleTouchStart(event: TouchEvent): void { event.preventDefault(); if (event.touches.length === 1) { const touch = event.touches[0]; this.lastTouchX = touch.clientX; this.lastTouchY = touch.clientY; this.isTouching = true; this.lastTouchTime = Date.now(); if (this.kineticScrollInterval !== null) { window.clearInterval(this.kineticScrollInterval); this.kineticScrollInterval = null; } this.editingManager.deactivateEditor(false); this.editingManager.hideDropdown(); } }
  private _handleTouchMove(event: TouchEvent): void { if (!this.isTouching || !this.lastTouchX || !this.lastTouchY) return; event.preventDefault(); if (event.touches.length === 1) { const touch = event.touches[0]; const currentX = touch.clientX; const currentY = touch.clientY; const rect = this.domManager.getCanvasBoundingClientRect(); const canvasX = currentX - rect.left; const canvasY = currentY - rect.top; const { headerHeight, rowNumberWidth } = this.options; const deltaX = this.lastTouchX - currentX; const deltaY = this.lastTouchY - currentY; const currentTime = Date.now(); const timeElapsed = currentTime - this.lastTouchTime; if (timeElapsed > 0) { this.touchVelocityX = (deltaX / timeElapsed) * 15; this.touchVelocityY = (deltaY / timeElapsed) * 15; } if (canvasX >= rowNumberWidth && canvasY >= headerHeight) { this.interactionManager.moveScroll(deltaX, deltaY); } else if (canvasY < headerHeight && canvasX >= rowNumberWidth) { this.interactionManager.moveScroll(deltaX, 0); } else if (canvasX < rowNumberWidth && canvasY >= headerHeight) { this.interactionManager.moveScroll(0, deltaY); } this._handleScroll(); this.lastTouchX = currentX; this.lastTouchY = currentY; this.lastTouchTime = currentTime; } }
  private _handleTouchEnd(event: TouchEvent): void { event.preventDefault(); this.isTouching = false; if ( Math.abs(this.touchVelocityX) > 0.5 || Math.abs(this.touchVelocityY) > 0.5 ) { this._startKineticScroll(); } }
  private _startKineticScroll(): void { const rect = this.domManager.getCanvasBoundingClientRect(); const lastTouchPosition = { x: this.lastTouchX !== null ? this.lastTouchX - rect.left : 0, y: this.lastTouchY !== null ? this.lastTouchY - rect.top : 0, }; const { headerHeight, rowNumberWidth } = this.options; if (this.kineticScrollInterval !== null) { window.clearInterval(this.kineticScrollInterval); } this.kineticScrollInterval = window.setInterval(() => { this.touchVelocityX *= 0.95; this.touchVelocityY *= 0.95; if ( Math.abs(this.touchVelocityX) < 0.5 && Math.abs(this.touchVelocityY) < 0.5 ) { window.clearInterval(this.kineticScrollInterval!); this.kineticScrollInterval = null; return; } if ( lastTouchPosition.x >= rowNumberWidth && lastTouchPosition.y >= headerHeight ) { this.interactionManager.moveScroll( this.touchVelocityX, this.touchVelocityY ); } else if ( lastTouchPosition.y < headerHeight && lastTouchPosition.x >= rowNumberWidth ) { this.interactionManager.moveScroll(this.touchVelocityX, 0); } else if ( lastTouchPosition.x < rowNumberWidth && lastTouchPosition.y >= headerHeight ) { this.interactionManager.moveScroll(0, this.touchVelocityY); } this._handleScroll(); }, 16); }
}
