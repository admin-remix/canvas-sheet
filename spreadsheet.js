/**
 * Canvas Spreadsheet Library
 * Renders a spreadsheet based on a schema and data using HTML Canvas.
 * Features: Viewport rendering, cell editing, searchable dropdowns, fill handle, copy/paste,
 * row selection (click, shift+click, ctrl+click), row deletion (delete key),
 * programmatic row addition, cell-level disabling.
 */
class Spreadsheet {
  constructor(containerId, schema, data = [], options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element with ID "${containerId}" not found.`);
    }

    this.schema = schema;
    this.columns = Object.keys(schema);
    // Initial data processing moved to setData

    // --- Configuration ---
    this.options = {
      cellWidth: 150,
      cellHeight: 30,
      headerHeight: 35,
      rowNumberWidth: 50,
      font: "14px Inter, sans-serif",
      headerFont: "bold 14px Inter, sans-serif",
      textColor: "#111827", // gray-900
      headerTextColor: "#ffffff", // white
      headerBgColor: "#4b5563", // gray-600
      gridLineColor: "#d1d5db", // gray-300
      rowNumberBgColor: "#f3f4f6", // gray-100
      selectedRowNumberBgColor: "#dbeafe", // blue-100
      disabledCellBgColor: "#e5e7eb", // gray-200
      disabledTextColor: "#9ca3af", // gray-400
      highlightBorderColor: "#3b82f6", // blue-500
      fillHandleColor: "#3b82f6", // blue-500
      fillHandleSize: 10,
      dragRangeBorderColor: "#6b7280", // gray-500
      // Renamed from isRowDisabled - checks individual cells now
      // Should return true if the specific cell should be disabled
      isCellDisabled: (rowIndex, colKey, rowData) => false, // Default: no cells disabled
      ...options,
    };
    // Store the function directly
    this.isCellDisabled = this.options.isCellDisabled;
    this.DISABLED_FIELD_PREFIX = "disabled:"; // Prefix for hidden disabled fields

    // --- State ---
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.totalContentWidth = 0;
    this.totalContentHeight = 0;
    this.visibleRowStartIndex = 0;
    this.visibleRowEndIndex = 0;
    this.visibleColStartIndex = 0;
    this.visibleColEndIndex = 0;
    this.activeEditor = null;
    this.dropdown = null;
    this.dropdownItems = [];
    this.highlightedDropdownIndex = -1;
    this.activeCell = null; // {row, col}
    // Row Selection State
    this.selectedRows = new Set(); // Stores indices of selected rows
    this.lastClickedRow = null; // For shift-click range selection
    // Fill Handle Drag State
    this.isDraggingFillHandle = false;
    this.dragStartCell = null;
    this.dragEndRow = null;
    // Copy/Paste State
    this.copiedValue = null;
    this.copiedValueType = null;
    this.copiedCell = null; // Tracks the cell coordinates for copy visual feedback

    // --- Initialization ---
    this._setupCanvas();
    this._setupDropdown();
    this._setupEditorInput();
    this.setData(data); // Process initial data, calculate dimensions & disabled states
    this._bindEvents();
    this.draw(); // Initial draw after setup
  }

  // --- Setup Methods ---

  _setupCanvas() {
    // ... (same as before)
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.container.appendChild(this.canvas);
    this.container.style.position = "relative";
    this.container.tabIndex = -1;
  }

  _setupDropdown() {
    // ... (same as before)
    this.dropdown = document.createElement("div");
    this.dropdown.className = "spreadsheet-dropdown";
    const searchContainer = document.createElement("div");
    searchContainer.className = "spreadsheet-dropdown-search";
    this.dropdownSearchInput = document.createElement("input");
    this.dropdownSearchInput.type = "text";
    this.dropdownSearchInput.placeholder = "Search...";
    searchContainer.appendChild(this.dropdownSearchInput);
    this.dropdownList = document.createElement("ul");
    this.dropdownList.className = "spreadsheet-dropdown-list";
    this.dropdown.appendChild(searchContainer);
    this.dropdown.appendChild(this.dropdownList);
    this.container.appendChild(this.dropdown);
    this.dropdown.addEventListener("mousedown", (e) => e.stopPropagation());
    this.dropdownSearchInput.addEventListener(
      "input",
      this._handleDropdownSearch.bind(this)
    );
    this.dropdownSearchInput.addEventListener(
      "keydown",
      this._handleDropdownKeyDown.bind(this)
    );
    this.dropdownList.addEventListener(
      "click",
      this._handleDropdownItemClick.bind(this)
    );
  }

  _setupEditorInput() {
    // ... (same as before)
    this.editorInput = document.createElement("input");
    this.editorInput.className = "spreadsheet-editor";
    this.editorInput.style.display = "none";
    this.container.appendChild(this.editorInput);
    this.editorInput.addEventListener(
      "blur",
      this._handleEditorBlur.bind(this)
    );
    this.editorInput.addEventListener(
      "keydown",
      this._handleEditorKeyDown.bind(this)
    );
  }

  // --- Dimension and Viewport Calculation ---

  _calculateDimensions() {
    // ... (same as before)
    this.totalContentWidth =
      this.options.rowNumberWidth +
      this.columns.length * this.options.cellWidth;
    this.totalContentHeight =
      this.options.headerHeight + this.data.length * this.options.cellHeight;
    this.viewportWidth = this.container.clientWidth;
    this.viewportHeight = this.container.clientHeight;
    this.canvas.width = this.totalContentWidth;
    this.canvas.height = this.totalContentHeight;
    this.canvas.style.width = `${this.totalContentWidth}px`;
    this.canvas.style.height = `${this.totalContentHeight}px`;
    this._calculateVisibleRange();
  }

  _calculateVisibleRange() {
    // ... (same as before)
    this.visibleRowStartIndex = Math.max(
      0,
      Math.floor(this.scrollTop / this.options.cellHeight)
    );
    this.visibleRowEndIndex = Math.min(
      this.data.length - 1,
      Math.floor(
        (this.scrollTop + this.viewportHeight - this.options.headerHeight) /
          this.options.cellHeight
      ) + 1
    );
    this.visibleColStartIndex = Math.max(
      0,
      Math.floor(this.scrollLeft / this.options.cellWidth)
    );
    this.visibleColEndIndex = Math.min(
      this.columns.length - 1,
      Math.floor(
        (this.scrollLeft + this.viewportWidth - this.options.rowNumberWidth) /
          this.options.cellWidth
      ) + 1
    );
  }

  // --- Event Binding ---

  _bindEvents() {
    // ... (same as before)
    this.container.addEventListener("scroll", this._handleScroll.bind(this));
    this.canvas.addEventListener(
      "dblclick",
      this._handleDoubleClick.bind(this)
    );
    this.canvas.addEventListener("click", this._handleClick.bind(this)); // Handles cell clicks AND row number clicks now
    this.canvas.addEventListener(
      "mousedown",
      this._handleCanvasMouseDown.bind(this)
    );
    document.addEventListener(
      "mousemove",
      this._handleDocumentMouseMove.bind(this)
    );
    document.addEventListener(
      "mouseup",
      this._handleDocumentMouseUp.bind(this)
    );
    window.addEventListener("resize", this._handleResize.bind(this));
    document.addEventListener(
      "mousedown",
      this._handleGlobalMouseDown.bind(this),
      true
    );
    document.addEventListener(
      "keydown",
      this._handleDocumentKeyDown.bind(this)
    );
  }

  // --- Event Handlers ---

  _handleScroll(event) {
    // ... (same as before)
    this.scrollTop = this.container.scrollTop;
    this.scrollLeft = this.container.scrollLeft;
    this._hideDropdown();
    this._deactivateEditor(false);
    this._calculateVisibleRange();
    this.draw();
  }

  _handleResize() {
    // ... (same as before)
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this._hideDropdown();
      this._deactivateEditor(false);
      this._calculateDimensions();
      this.draw();
    }, 100);
  }

  _handleDoubleClick(event) {
    // ... (same as before, uses updated _isCellDisabled check implicitly via _activateEditor)
    const { row, col } = this._getCoordsFromEvent(event);
    if (row === null || col === null) return;
    // Check using the pre-calculated field
    const rowData = this.data[row] || {};
    const colKey = this.columns[col];
    if (rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`]) {
      console.log(`Edit prevented: Cell ${row},${col} is disabled.`);
      return;
    }
    this.activeCell = { row, col };
    this._clearSelectedRows(); // Deselect rows when editing a cell
    this._activateEditor(row, col);
  }

  _handleClick(event) {
    // Prevent interfering with drag start
    if (this.isDraggingFillHandle) return;
  
    const { row, col } = this._getCoordsFromEvent(event);
    const isCellClick = row !== null && col !== null;
    const isRowNumberClick =
      row !== null &&
      col === null &&
      event.offsetX < this.options.rowNumberWidth;
    let redrawNeeded = false;
  
    if (isRowNumberClick) {
      this._handleRowNumberClick(
        row,
        event.shiftKey,
        event.ctrlKey || event.metaKey
      );
      this.activeCell = null; // Deselect active cell when selecting rows
      if (this.activeEditor) this._deactivateEditor(true); // Deactivate editor if active
      redrawNeeded = true;
    } else if (isCellClick) {
      // If an editor is active and we click a different cell, save the editor
      if (
        this.activeEditor &&
        (this.activeEditor.row !== row || this.activeEditor.col !== col)
      ) {
        this._deactivateEditor(true); // Save changes
      }
      // If a dropdown is active and we click a different cell, close it
      if (
        this.dropdown.style.display !== "none" &&
        (!this.activeEditor ||
          this.activeEditor.row !== row ||
          this.activeEditor.col !== col)
      ) {
        this._hideDropdown();
      }
      // Set the new active cell and clear row selection
      if (!this.activeCell || this.activeCell.row !== row || this.activeCell.col !== col) {
          this.activeCell = { row, col };
          this._clearSelectedRows();
          redrawNeeded = true;
      }
  
    } else {
      // Clicked outside cells and row numbers (e.g., header, empty space)
      if (this.activeEditor) {
        this._deactivateEditor(true); // Save if editor was active
        redrawNeeded = true; // DeactivateEditor calls draw, but set flag just in case
      } else if (this.dropdown.style.display !== "none") {
        this._hideDropdown();
      } else if (this.activeCell || this.selectedRows.size > 0) {
        this.activeCell = null; // Deselect cell
        this._clearSelectedRows(); // Deselect rows
        redrawNeeded = true;
      }
    }
  
    if (redrawNeeded) {
        this.draw();
    }
  }

  _handleRowNumberClick(clickedRow, isShiftKey, isCtrlKey) {
    console.log(
      `Row ${clickedRow} clicked. Shift: ${isShiftKey}, Ctrl: ${isCtrlKey}`
    );
    if (isShiftKey && this.lastClickedRow !== null) {
      // Shift + Click: Select range
      this.selectedRows.clear(); // Clear previous selection for range select
      const start = Math.min(this.lastClickedRow, clickedRow);
      const end = Math.max(this.lastClickedRow, clickedRow);
      for (let i = start; i <= end; i++) {
        this.selectedRows.add(i);
      }
      console.log(
        "Selected rows (Shift):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    } else if (isCtrlKey) {
      // Ctrl/Cmd + Click: Toggle selection
      if (this.selectedRows.has(clickedRow)) {
        this.selectedRows.delete(clickedRow);
      } else {
        this.selectedRows.add(clickedRow);
      }
      this.lastClickedRow = clickedRow; // Update last clicked for potential subsequent shift-click
      console.log(
        "Selected rows (Ctrl):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    } else {
      // Simple Click: Select only this row
      this.selectedRows.clear();
      this.selectedRows.add(clickedRow);
      this.lastClickedRow = clickedRow;
      console.log(
        "Selected rows (Single):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    }
  }

  _clearSelectedRows() {
    if (this.selectedRows.size > 0) {
      this.selectedRows.clear();
      this.lastClickedRow = null;
      // No redraw here, assumes caller will redraw
    }
  }

  _handleCanvasMouseDown(event) {
    // ... (fill handle logic remains the same)
    if (!this.activeCell) return;
    const { row, col } = this._getCoordsFromEvent(event); // Get coords relative to content
    const handleBounds = this._getFillHandleBounds(
      this.activeCell.row,
      this.activeCell.col
    ); // Gets bounds relative to viewport

    // Need click coords relative to viewport for handle check
    const rect = this.canvas.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;

    if (
      handleBounds &&
      viewportX >= handleBounds.x &&
      viewportX <= handleBounds.x + handleBounds.width &&
      viewportY >= handleBounds.y &&
      viewportY <= handleBounds.y + handleBounds.height
    ) {
      this.isDraggingFillHandle = true;
      this.dragStartCell = { ...this.activeCell };
      this.dragEndRow = this.activeCell.row;
      this.canvas.style.cursor = "crosshair";
      event.preventDefault();
      event.stopPropagation();
      console.log("Started dragging fill handle from", this.dragStartCell);
    }
  }

  /**
   * Handles mouse movement over the document.
   * Primarily used for fill handle dragging and cursor updates.
   */
  _handleDocumentMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    let isOnHandle = false;

    // Check if hovering over the fill handle when not dragging
    if (!this.isDraggingFillHandle && this.activeCell && !this.activeEditor) {
      const handleBounds = this._getFillHandleBounds(this.activeCell.row, this.activeCell.col);
      if (handleBounds &&
          viewportX >= handleBounds.x &&
          viewportX <= handleBounds.x + handleBounds.width &&
          viewportY >= handleBounds.y &&
          viewportY <= handleBounds.y + handleBounds.height) {
        isOnHandle = true;
      }
    }

    // Set cursor style
    if (this.isDraggingFillHandle || isOnHandle) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default'; // Reset cursor if not dragging and not on handle
    }

    // Handle dragging updates
    if (this.isDraggingFillHandle) {
      const { row } = this._getCoordsFromEvent(event); // Get coords relative to content
      if (row !== null && row >= this.dragStartCell.row) {
        // Dragging down or staying on the same row
        if (row !== this.dragEndRow) {
          this.dragEndRow = row;
          this.draw(); // Redraw drag range
        }
      } else if (row !== null && row < this.dragStartCell.row) {
        // Dragging upwards beyond the start row - snap back to start row
        if (this.dragEndRow !== this.dragStartCell.row) {
          this.dragEndRow = this.dragStartCell.row;
          this.draw(); // Redraw drag range snapped back
        }
      }
      // If row is null (e.g., mouse moved off canvas), keep the last valid dragEndRow
    }
  }

  /**
   * Handles mouse up events anywhere on the document.
   * Primarily used to end fill handle dragging.
   */
  _handleDocumentMouseUp(event) {
    if (this.isDraggingFillHandle) {
      console.log("Finished dragging fill handle to row", this.dragEndRow);
      this._performFillDown();
      this.isDraggingFillHandle = false;
      this.dragStartCell = null;
      this.dragEndRow = null;
      // Cursor will be reset by the next mousemove event based on position
      // this.canvas.style.cursor = 'default'; // No longer strictly needed here
      this.draw();
    }
  }

  _handleGlobalMouseDown(event) {
    if (this.isDraggingFillHandle) return;
    if (!this.container.contains(event.target)) {
      let needsRedraw = false;
      if (this.activeEditor) {
        this._deactivateEditor(true); // This calls draw
      } else if (this.dropdown.style.display !== "none") {
        this._hideDropdown();
      } else if (this.activeCell || this.selectedRows.size > 0 || this.copiedCell) {
        this.activeCell = null;
        this._clearSelectedRows();
        this.copiedCell = null; // Clear copy indicator
        needsRedraw = true;
      }
      if (needsRedraw) {
          this.draw();
      }
    }
  }

  _handleDocumentKeyDown(event) {
    const isCtrl = event.ctrlKey || event.metaKey;

    // Prioritize editor input if active
    if (this.activeEditor || this.dropdown.style.display !== "none") {
      // Let editor/dropdown handle their keys (handled in their own keydown listeners)
      return;
    }

    if (isCtrl && event.key === "c") {
      // Copy Cell
      if (this.activeCell) {
        const { row, col } = this.activeCell;
        const colKey = this.columns[col];
        this.copiedValue = this.data[row]?.[colKey];
        this.copiedValueType = this.schema[colKey]?.type;
        this.copiedCell = { ...this.activeCell }; // Store coords for visual feedback
        console.log(
          `Copied value: ${this.copiedValue} (Type: ${this.copiedValueType}) from cell ${row},${col}`
        );
        this.draw(); // Redraw to show dashed border
        event.preventDefault();
      }
    } else if (isCtrl && event.key === "v") {
      // Paste Cell
      if (this.activeCell && this.copiedValue !== null) {
        this._performPaste();
        event.preventDefault();
      }
    } else if (event.key === "Delete") {
      // Delete Rows
      if (this.selectedRows.size > 0) {
        this._deleteSelectedRows();
        event.preventDefault();
      }
    }
  }

  // --- Drawing Methods ---

  draw() {
    // ... (same structure as before)
    this.ctx.save();
    this.ctx.font = this.options.font;
    this._clearCanvas();
    this.ctx.translate(-this.scrollLeft, -this.scrollTop);
    this._drawHeaders();
    this._drawRowNumbers(); // Updated to show selection
    this._drawCells();
    this._drawGridLines();
    this._drawCopiedCellHighlight(); // Draw dashed border for copied cell
    this._drawHighlight();// Draw solid border for active cell (and fill handle)
    this._drawDragRange();
    this.ctx.restore();
    this._drawCornerBox();
  }

  _clearCanvas() {
    // ... (same as before)
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(
      this.scrollLeft,
      this.scrollTop,
      this.viewportWidth,
      this.viewportHeight
    );
  }

  _drawCornerBox() {
    // ... (same as before)
    const { rowNumberWidth, headerHeight, gridLineColor, rowNumberBgColor } =
      this.options;
    const x = 0;
    const y = 0;
    this.ctx.fillStyle = rowNumberBgColor;
    this.ctx.fillRect(x, y, rowNumberWidth, headerHeight);
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.strokeRect(x + 0.5, y + 0.5, rowNumberWidth, headerHeight);
  }

  _drawHeaders() {
    // ... (same as before)
    const {
      cellWidth,
      headerHeight,
      rowNumberWidth,
      headerFont,
      headerBgColor,
      headerTextColor,
      gridLineColor,
    } = this.options;
    this.ctx.save();
    this.ctx.font = headerFont;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    const headerAreaX = rowNumberWidth;
    const headerAreaY = 0;
    const headerAreaWidth = this.totalContentWidth - rowNumberWidth;
    const headerAreaHeight = headerHeight;
    this.ctx.beginPath();
    this.ctx.rect(headerAreaX, headerAreaY, headerAreaWidth, headerAreaHeight);
    this.ctx.clip();
    this.ctx.fillStyle = headerBgColor;
    this.ctx.fillRect(
      headerAreaX,
      headerAreaY,
      headerAreaWidth,
      headerAreaHeight
    );
    for (
      let col = this.visibleColStartIndex;
      col <= this.visibleColEndIndex;
      col++
    ) {
      if (col >= this.columns.length) continue;
      const colKey = this.columns[col];
      const schemaCol = this.schema[colKey];
      const headerText = schemaCol?.label || colKey;
      const x = rowNumberWidth + col * cellWidth;
      const y = 0;
      const width = cellWidth;
      const height = headerHeight;
      this.ctx.fillStyle = headerTextColor;
      this.ctx.fillText(headerText, x + width / 2, y + height / 2, width - 10);
      this.ctx.strokeStyle = gridLineColor;
      this.ctx.beginPath();
      this.ctx.moveTo(x + width - 0.5, y);
      this.ctx.lineTo(x + width - 0.5, y + height);
      this.ctx.stroke();
    }
    this.ctx.restore();
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.beginPath();
    this.ctx.moveTo(rowNumberWidth, headerHeight - 0.5);
    this.ctx.lineTo(this.totalContentWidth, headerHeight - 0.5);
    this.ctx.stroke();
  }

  _drawRowNumbers() {
    // Assumes context is translated by (-scrollLeft, -scrollTop)
    const {
      cellHeight,
      headerHeight,
      rowNumberWidth,
      font,
      rowNumberBgColor,
      selectedRowNumberBgColor,
      textColor,
      gridLineColor,
    } = this.options; // Added selectedRowNumberBgColor
    this.ctx.save();
    this.ctx.font = font;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    // Define the row number area in CONTENT coordinates for drawing
    const rowNumAreaX = 0;
    const rowNumAreaY = headerHeight;
    const rowNumAreaWidth = rowNumberWidth;
    const rowNumAreaHeight = this.totalContentHeight - headerHeight;

    // Clip drawing to the row number area (relative to translated origin)
    this.ctx.beginPath();
    this.ctx.rect(rowNumAreaX, rowNumAreaY, rowNumAreaWidth, rowNumAreaHeight);
    this.ctx.clip();

    // Draw the default background for the entire visible row number area once
    this.ctx.fillStyle = rowNumberBgColor;
    this.ctx.fillRect(
      rowNumAreaX,
      rowNumAreaY,
      rowNumAreaWidth,
      rowNumAreaHeight
    );

    // Only iterate over rows potentially visible
    for (
      let row = this.visibleRowStartIndex;
      row <= this.visibleRowEndIndex;
      row++
    ) {
      if (row >= this.data.length) continue; // Skip if index out of bounds

      // Calculate position in content coordinates (already translated)
      const x = 0;
      const y = headerHeight + row * cellHeight;
      const width = rowNumberWidth;
      const height = cellHeight;

      // --- Draw Background (Highlight if selected) ---
      if (this.selectedRows.has(row)) {
        this.ctx.fillStyle = selectedRowNumberBgColor;
        this.ctx.fillRect(x, y, width, height); // Redraw background for selected row
      }
      // else: Default background already drawn

      // --- Draw Text ---
      this.ctx.fillStyle = textColor;
      this.ctx.fillText((row + 1).toString(), x + width / 2, y + height / 2);

      // --- Draw Bottom Border ---
      this.ctx.strokeStyle = gridLineColor;
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + height - 0.5); // Offset for sharpness
      this.ctx.lineTo(x + width, y + height - 0.5);
      this.ctx.stroke();
    }
    this.ctx.restore(); // Restore clipping

    // Draw right border for the entire row number column (relative to translated origin)
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.beginPath();
    this.ctx.moveTo(rowNumberWidth - 0.5, headerHeight); // Offset for sharp line
    this.ctx.lineTo(rowNumberWidth - 0.5, this.totalContentHeight);
    this.ctx.stroke();
  }

  _drawCells() {
    // Uses pre-calculated disabled state
    const {
      cellWidth,
      cellHeight,
      headerHeight,
      rowNumberWidth,
      font,
      textColor,
      disabledCellBgColor,
      disabledTextColor,
    } = this.options;
    this.ctx.save();
    this.ctx.font = font;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "middle";
    this.ctx.beginPath();
    this.ctx.rect(
      rowNumberWidth,
      headerHeight,
      this.totalContentWidth - rowNumberWidth,
      this.totalContentHeight - headerHeight
    );
    this.ctx.clip();

    for (
      let row = this.visibleRowStartIndex;
      row <= this.visibleRowEndIndex;
      row++
    ) {
      if (row >= this.data.length) continue;
      const rowData = this.data[row] || {};

      for (
        let col = this.visibleColStartIndex;
        col <= this.visibleColEndIndex;
        col++
      ) {
        if (col >= this.columns.length) continue;
        if (
          this.activeEditor &&
          this.activeEditor.row === row &&
          this.activeEditor.col === col
        )
          continue;

        const colKey = this.columns[col];
        const cellValue = rowData[colKey];
        const schemaCol = this.schema[colKey];
        const x = rowNumberWidth + col * cellWidth;
        const y = headerHeight + row * cellHeight;
        const width = cellWidth;
        const height = cellHeight;

        // Check pre-calculated disabled state
        const isDisabledCell =
          !!rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`]; // Use hidden field

        // --- Draw Cell Background ---
        this.ctx.fillStyle = isDisabledCell ? disabledCellBgColor : "#ffffff";
        this.ctx.fillRect(x, y, width, height);

        // --- Draw Cell Content ---
        this.ctx.fillStyle = isDisabledCell ? disabledTextColor : textColor;
        let displayValue = this._formatValue(cellValue, schemaCol.type);
        if (
          schemaCol.type === "select" &&
          schemaCol.values &&
          cellValue !== undefined &&
          cellValue !== null
        ) {
          const selectedOption = schemaCol.values.find(
            (v) => v.id === cellValue
          );
          displayValue = selectedOption ? selectedOption.name : "";
        } else if (schemaCol.type === "boolean") {
          displayValue =
            cellValue === true ? "True" : cellValue === false ? "False" : "";
        }

        const textPadding = 5;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x + textPadding, y, width - textPadding * 2, height);
        this.ctx.clip();
        this.ctx.fillText(displayValue, x + textPadding, y + height / 2);
        this.ctx.restore();
      }
    }
    this.ctx.restore();
  }

  _drawGridLines() {
    // ... (same as before)
    const {
      cellWidth,
      cellHeight,
      headerHeight,
      rowNumberWidth,
      gridLineColor,
    } = this.options;
    this.ctx.save();
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.lineWidth = 1;
    const startX = rowNumberWidth;
    const startY = headerHeight;
    const gridContentEndX = rowNumberWidth + this.columns.length * cellWidth;
    const gridContentEndY = headerHeight + this.data.length * cellHeight;
    for (
      let col = this.visibleColStartIndex;
      col <= this.visibleColEndIndex + 1;
      col++
    ) {
      if (col > this.columns.length) continue;
      const x = Math.round(rowNumberWidth + col * cellWidth);
      if (x >= startX && x <= gridContentEndX) {
        this.ctx.beginPath();
        this.ctx.moveTo(x - 0.5, startY);
        this.ctx.lineTo(x - 0.5, gridContentEndY);
        this.ctx.stroke();
      }
    }
    for (
      let row = this.visibleRowStartIndex;
      row <= this.visibleRowEndIndex + 1;
      row++
    ) {
      if (row > this.data.length) continue;
      const y = Math.round(headerHeight + row * cellHeight);
      if (y >= startY && y <= gridContentEndY) {
        this.ctx.beginPath();
        this.ctx.moveTo(startX, y - 0.5);
        this.ctx.lineTo(gridContentEndX, y - 0.5);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  _drawHighlight() {
    // ... (same as before, draws highlight border and fill handle)
    if (!this.activeCell || this.isDraggingFillHandle) return;
    const { row, col } = this.activeCell;
    const {
      cellWidth,
      cellHeight,
      headerHeight,
      rowNumberWidth,
      highlightBorderColor,
      fillHandleSize,
      fillHandleColor,
    } = this.options;
    const x = rowNumberWidth + col * cellWidth;
    const y = headerHeight + row * cellHeight;
    const bounds = this.getCellBounds(row, col);
    if (!bounds) return;
    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    if (!this.activeEditor) {
      const handleX = x + cellWidth - 1;
      const handleY = y + cellHeight - 1;
      this.ctx.fillStyle = fillHandleColor;
      this.ctx.beginPath();
      this.ctx.arc(
        handleX,
        handleY,
        fillHandleSize / 2,
        0,
        Math.PI * 2
      );
      this.ctx.fill();
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  _drawDragRange() {
    // ... (same as before)
    if (
      !this.isDraggingFillHandle ||
      this.dragEndRow === null ||
      this.dragEndRow === this.dragStartCell.row
    )
      return;
    const {
      cellWidth,
      cellHeight,
      headerHeight,
      rowNumberWidth,
      dragRangeBorderColor,
    } = this.options;
    const startRow = this.dragStartCell.row;
    const startCol = this.dragStartCell.col;
    const endRow = this.dragEndRow;
    const x = rowNumberWidth + startCol * cellWidth;
    const y = headerHeight + (startRow + 1) * cellHeight;
    const width = cellWidth;
    const height = (endRow - startRow) * cellHeight;
    if (height <= 0) return;
    this.ctx.save();
    this.ctx.strokeStyle = dragRangeBorderColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 2]);
    this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    this.ctx.restore();
  }

  /**
 * Draws a dashed border around the copied cell for visual feedback.
 */
_drawCopiedCellHighlight() {
    if (!this.copiedCell) return;
  
    const { row, col } = this.copiedCell;
    const bounds = this.getCellBounds(row, col);
    if (!bounds) return; // Cell not visible
  
    const { highlightBorderColor } = this.options;
    const { x, y, width, height } = bounds;
  
    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor; // Use the same color as active highlight for now
    this.ctx.lineWidth = 1; // Use a thin line for the dash
    this.ctx.setLineDash([4, 2]); // Define the dash pattern
  
    // Adjust slightly to draw inside the cell boundary like the active highlight
    this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  
    this.ctx.restore(); // Restore line dash and other settings
  }

  // --- Cell Editing and Dropdown Logic ---

  _activateEditor(rowIndex, colIndex) {
    // Check pre-calculated disabled state before activating
    const rowData = this.data[rowIndex] || {};
    const colKey = this.columns[colIndex];
    if (rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`]) {
      console.log(`Edit prevented: Cell ${rowIndex},${colIndex} is disabled.`);
      return;
    }

    // ... (rest of the logic is same as before)
    if (this.activeEditor) {
      this._deactivateEditor(true);
    }
    this._hideDropdown();
    const schemaCol = this.schema[colKey];
    const cellValue = this.data[rowIndex]?.[colKey];
    const bounds = this.getCellBounds(rowIndex, colIndex);
    if (!bounds) return;
    this.activeEditor = {
      row: rowIndex,
      col: colIndex,
      type: schemaCol.type,
      originalValue: cellValue,
    };
    const editorX = bounds.x;
    const editorY = bounds.y;

    if (schemaCol.type === "select" || schemaCol.type === "boolean") {
      this._showDropdown(
        rowIndex,
        colIndex,
        schemaCol,
        editorX,
        editorY,
        bounds.width,
        bounds.height
      );
    } else {
      this.editorInput.style.display = "block";
      this.editorInput.style.left = `${editorX}px`;
      this.editorInput.style.top = `${editorY}px`;
      this.editorInput.style.width = `${bounds.width}px`;
      this.editorInput.style.height = `${bounds.height}px`;
      this.editorInput.style.font = this.options.font;
      if (schemaCol.type === "number") {
        this.editorInput.type = "number";
        this.editorInput.step = schemaCol.decimal === false ? "1" : "any";
      } else if (schemaCol.type === "email") {
        this.editorInput.type = "email";
      } else if (schemaCol.type === "date") {
        this.editorInput.type = "date";
      } else {
        this.editorInput.type = "text";
      }
      this.editorInput.value = this._formatValueForInput(
        cellValue,
        schemaCol.type
      );
      this.editorInput.focus();
      this.editorInput.select();
    }
    this.draw();
  }

  _deactivateEditor(saveChanges = true) {
    if (!this.activeEditor) return;
    const { row, col, type, originalValue } = this.activeEditor;
    let valueChanged = false;

    if (type === "select" || type === "boolean") {
      this._hideDropdown();
      // Value change is handled by dropdown click, need to check if it actually changed
      // The activeEditor state doesn't update on dropdown click, so we check data directly
      const colKey = this.columns[col];
      valueChanged = this.data[row]?.[colKey] !== originalValue;
    } else {
      if (saveChanges) {
        const newValueRaw = this.editorInput.value;
        const colKey = this.columns[col];
        const schemaCol = this.schema[colKey];
        const newValue = this._parseValueFromInput(newValueRaw, schemaCol.type);
        let isValid = this._validateInput(newValue, schemaCol, colKey);
        if (isValid && newValue !== originalValue) {
          if (!this.data[row]) {
            this.data[row] = {};
          }
          this.data[row][colKey] = newValue;
          valueChanged = true;
        } else if (!isValid) {
          console.log("Change not saved due to validation error or no change.");
        }
      }
      this.editorInput.style.display = "none";
      this.editorInput.value = "";
    }

    this.activeEditor = null; // Deactivate editor state *before* updating disabled states

    // If value changed, update disabled states for the affected row
    if (valueChanged) {
      this._updateDisabledStatesForRow(row);
    }

    this.draw(); // Redraw AFTER potential disabled state updates
  }

  _validateInput(value, schemaCol, colKey) {
    // ... (same as before)
    if (!schemaCol) return true; // No schema, no validation
    if (
      schemaCol.required &&
      (value === null || value === undefined || value === "")
    ) {
      console.warn(`Validation failed: Column "${colKey}" is required.`);
      return false;
    }
    if (
      schemaCol.type === "text" &&
      schemaCol.maxlength &&
      typeof value === "string" &&
      value.length > schemaCol.maxlength
    ) {
      console.warn(
        `Validation failed: Column "${colKey}" exceeds max length of ${schemaCol.maxlength}.`
      );
      return false;
    }
    if (
      schemaCol.type === "email" &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      console.warn(
        `Validation failed: Invalid email format for column "${colKey}".`
      );
      return false;
    }
    return true;
  }

  _handleEditorBlur(event) {
    // ... (same as before)
    setTimeout(() => {
      if (
        document.activeElement !== this.editorInput &&
        !this.dropdown.contains(document.activeElement)
      ) {
        this._deactivateEditor(true);
      }
    }, 0);
  }

  _handleEditorKeyDown(event) {
    // ... (same as before)
    switch (event.key) {
      case "Enter":
        this._deactivateEditor(true);
        this._moveActiveCell(1, 0);
        event.preventDefault();
        break;
      case "Escape":
        this._deactivateEditor(false);
        this.activeCell = null;
        this.draw();
        event.preventDefault();
        break;
      case "Tab":
        this._deactivateEditor(true);
        this._moveActiveCell(0, event.shiftKey ? -1 : 1);
        event.preventDefault();
        break;
    }
  }

  _moveActiveCell(rowDelta, colDelta) {
    // ... (same as before)
    if (!this.activeCell) return;
    let currentRow = this.activeCell.row;
    let currentCol = this.activeCell.col;
    let nextRow = currentRow + rowDelta;
    let nextCol = currentCol + colDelta;
    let targetFound = false;
    let safetyCounter = 0;
    const maxSearch = Math.max(this.data.length, this.columns.length) + 1;
    while (!targetFound && safetyCounter < maxSearch) {
      safetyCounter++;
      if (nextCol >= this.columns.length) {
        nextCol = 0;
        nextRow++;
      } else if (nextCol < 0) {
        nextCol = this.columns.length - 1;
        nextRow--;
      }
      if (
        nextRow < 0 ||
        nextRow >= this.data.length ||
        nextCol < 0 ||
        nextCol >= this.columns.length
      ) {
        this.activeCell = null;
        this.draw();
        return;
      }
      const nextRowData = this.data[nextRow] || {};
      const nextColKey = this.columns[nextCol];
      if (!nextRowData[`${this.DISABLED_FIELD_PREFIX}${nextColKey}`]) {
        // Check target cell disabled state
        targetFound = true;
        this.activeCell = { row: nextRow, col: nextCol };
        this._activateEditor(nextRow, nextCol);
      } else {
        if (rowDelta !== 0) nextRow += rowDelta > 0 ? 1 : -1;
        else if (colDelta !== 0) nextCol += colDelta > 0 ? 1 : -1;
        else {
          this.activeCell = null;
          this.draw();
          return;
        }
      }
    }
    if (!targetFound) {
      console.warn("Could not find next non-disabled cell in direction.");
      this.activeCell = null;
      this.draw();
    }
  }

  _showDropdown(
    rowIndex,
    colIndex,
    schemaCol,
    boundsX,
    boundsY,
    boundsWidth,
    boundsHeight
  ) {
    // ... (same as before)
    this.dropdownItems = [];
    this.dropdownList.innerHTML = "";
    if (schemaCol.type === "boolean") {
      this.dropdownItems = [
        { id: true, name: "True" },
        { id: false, name: "False" },
        { id: null, name: "(Blank)" },
      ];
    } else if (schemaCol.type === "select" && schemaCol.values) {
      this.dropdownItems = [{ id: null, name: "(Blank)" }, ...schemaCol.values];
    }
    this.dropdownItems.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "spreadsheet-dropdown-item";
      li.textContent = item.name;
      li.dataset.index = index;
      li.dataset.value = String(item.id);
      this.dropdownList.appendChild(li);
    });
    this.dropdown.style.display = "block";
    this.dropdown.style.left = `${boundsX}px`;
    this.dropdown.style.top = `${boundsY + boundsHeight}px`;
    this.dropdown.style.minWidth = `${boundsWidth}px`;
    const dropdownRect = this.dropdown.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    if (
      dropdownRect.bottom > containerRect.bottom &&
      boundsY > dropdownRect.height
    ) {
      this.dropdown.style.top = `${boundsY - dropdownRect.height}px`;
    }
    if (dropdownRect.right > containerRect.right) {
      const newLeft = containerRect.right - dropdownRect.width - 5;
      this.dropdown.style.left = `${Math.max(0, newLeft)}px`;
    }
    this.dropdownSearchInput.value = "";
    this._filterDropdown("");
    this.dropdownSearchInput.focus();
    this.highlightedDropdownIndex = -1;
  }

  _hideDropdown() {
    // ... (same as before)
    if (this.dropdown) {
      this.dropdown.style.display = "none";
      this.highlightedDropdownIndex = -1;
    }
  }

  _handleDropdownSearch() {
    // ... (same as before)
    const searchTerm = this.dropdownSearchInput.value.toLowerCase();
    this._filterDropdown(searchTerm);
    const firstVisibleItem = this.dropdownList.querySelector("li:not(.hidden)");
    const items = Array.from(
      this.dropdownList.querySelectorAll("li:not(.hidden)")
    );
    this.highlightedDropdownIndex = firstVisibleItem
      ? items.indexOf(firstVisibleItem)
      : -1;
    this._updateDropdownHighlight(items);
  }

  _filterDropdown(searchTerm) {
    // ... (same as before)
    const items = this.dropdownList.querySelectorAll("li");
    items.forEach((item) => {
      const itemText = item.textContent.toLowerCase();
      const isVisible = itemText.includes(searchTerm);
      item.classList.toggle("hidden", !isVisible);
    });
  }

  _handleDropdownKeyDown(event) {
    // ... (same as before)
    const visibleItems = Array.from(
      this.dropdownList.querySelectorAll("li:not(.hidden)")
    );
    if (!visibleItems.length && event.key !== "Escape") return;
    let currentHighlight = this.highlightedDropdownIndex;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        currentHighlight = (currentHighlight + 1) % visibleItems.length;
        break;
      case "ArrowUp":
        event.preventDefault();
        currentHighlight =
          (currentHighlight - 1 + visibleItems.length) % visibleItems.length;
        break;
      case "Enter":
        event.preventDefault();
        if (currentHighlight >= 0 && currentHighlight < visibleItems.length) {
          visibleItems[currentHighlight].click();
        } else if (visibleItems.length === 1) {
          visibleItems[0].click();
        }
        return;
      case "Escape":
        event.preventDefault();
        this._deactivateEditor(false);
        return;
      case "Tab":
        event.preventDefault();
        break;
      default:
        return;
    }
    this.highlightedDropdownIndex = currentHighlight;
    this._updateDropdownHighlight(visibleItems);
  }

  _updateDropdownHighlight(visibleItems) {
    // ... (same as before)
    visibleItems.forEach((item, index) => {
      const isHighlighted = index === this.highlightedDropdownIndex;
      item.classList.toggle("highlighted", isHighlighted);
      if (isHighlighted) {
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  _handleDropdownItemClick(event) {
    // Value change detection happens in _deactivateEditor
    if (event.target.tagName === "LI" && this.activeEditor) {
      const clickedItem = event.target;
      const itemIndex = parseInt(clickedItem.dataset.index, 10);
      const selectedData = this.dropdownItems[itemIndex];
      const { row, col } = this.activeEditor;
      const colKey = this.columns[col];
      if (!this.data[row]) {
        this.data[row] = {};
      }
      this.data[row][colKey] = selectedData.id;
      this._deactivateEditor(false); // Deactivate, let it handle redraw and disabled state update
      this.activeCell = null;
      // No draw here, _deactivateEditor handles it
    }
  }

  // --- Fill Handle, Copy/Paste, Delete, Disable Logic ---

  _performFillDown() {
    // Uses pre-calculated disabled state
    if (
      !this.dragStartCell ||
      this.dragEndRow === null ||
      this.dragEndRow <= this.dragStartCell.row
    )
      return;
    const startRow = this.dragStartCell.row;
    const startCol = this.dragStartCell.col;
    const endRow = this.dragEndRow;
    const colKey = this.columns[startCol];
    const sourceValue = this.data[startRow]?.[colKey];
    const sourceType = this.schema[colKey]?.type;
    let changed = false;

    for (let row = startRow + 1; row <= endRow; row++) {
      if (row >= this.data.length) continue;
      const targetSchema = this.schema[colKey];
      const isDisabledCell =
        !!this.data[row]?.[`${this.DISABLED_FIELD_PREFIX}${colKey}`]; // Check hidden field

      if (isDisabledCell) {
        console.log(`Skipping fill for disabled cell ${row},${startCol}`);
        continue;
      }
      if (targetSchema?.type !== sourceType) {
        console.log(`Skipping fill for row ${row}: Type mismatch`);
        continue;
      }

      if (!this.data[row]) {
        this.data[row] = {};
      }
      if (this.data[row][colKey] !== sourceValue) {
        this.data[row][colKey] = sourceValue;
        this._updateDisabledStatesForRow(row); // Update dependent disabled states *after* changing value
        changed = true;
      }
    }
    // No redraw here, caller (_handleDocumentMouseUp) handles it
  }

  _performPaste() {
    // Uses pre-calculated disabled state
    if (
      !this.activeCell ||
      this.copiedValue === null ||
      this.copiedValueType === null
    )
      return;
    const targetRow = this.activeCell.row;
    const targetCol = this.activeCell.col;
    const targetColKey = this.columns[targetCol];
    const targetSchema = this.schema[targetColKey];
    const targetType = targetSchema?.type;
    const isDisabledCell =
      !!this.data[targetRow]?.[`${this.DISABLED_FIELD_PREFIX}${targetColKey}`]; // Check hidden field

    if (isDisabledCell) {
      console.log(
        `Paste cancelled: Target cell ${targetRow},${targetCol} is disabled.`
      );
      return;
    }
    if (targetType !== this.copiedValueType) {
      console.log(`Paste cancelled: Type mismatch`);
      return;
    }
    if (!this._validateInput(this.copiedValue, targetSchema, targetColKey)) {
      console.log(`Paste cancelled: Copied value failed validation.`);
      return;
    }

    if (!this.data[targetRow]) {
      this.data[targetRow] = {};
    }
    if (this.data[targetRow][targetColKey] !== this.copiedValue) {
      this.data[targetRow][targetColKey] = this.copiedValue;
      this._updateDisabledStatesForRow(targetRow); // Update dependent disabled states
      this.copiedCell = null; // Clear copied cell indicator after paste
      this.draw(); // Redraw to show pasted value and potential disabled state changes
    } else {
      // Even if value is the same, clear the indicator on paste attempt
      this.copiedCell = null;
      this.draw();
    }
  }

  _deleteSelectedRows() {
    if (this.selectedRows.size === 0) return;

    // Get indices and sort descending to avoid shifting issues during splice
    const rowsToDelete = Array.from(this.selectedRows).sort((a, b) => b - a);
    console.log("Deleting rows:", rowsToDelete);

    rowsToDelete.forEach((rowIndex) => {
      if (rowIndex >= 0 && rowIndex < this.data.length) {
        this.data.splice(rowIndex, 1);
      }
    });

    this.selectedRows.clear();
    this.lastClickedRow = null;
    this.activeCell = null; // Deselect active cell after deleting rows
    this.copiedCell = null; // Clear copied cell indicator
    this._calculateDimensions(); // Recalculate total height, etc.
    this.draw();
  }

  _updateDisabledStatesForRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= this.data.length) return;
    const rowData = this.data[rowIndex];
    if (!rowData) return; // Should not happen, but safety check

    //console.log(`Updating disabled states for row ${rowIndex}`, rowData);
    let changed = false;
    this.columns.forEach((colKey) => {
      const disabledKey = `${this.DISABLED_FIELD_PREFIX}${colKey}`;
      const currentDisabledState = !!rowData[disabledKey];
      const newDisabledState = !!this.isCellDisabled(rowIndex, colKey, rowData); // Call the user-provided function

      if (currentDisabledState !== newDisabledState) {
        rowData[disabledKey] = newDisabledState;
        changed = true;
        // console.log(`  Cell ${rowIndex},${colKey} disabled state set to ${newDisabledState}`);
      }
    });
    return changed; // Return true if any state changed
  }

  _updateAllDisabledStates() {
    console.log("Updating all disabled states...");
    this.data.forEach((_, rowIndex) => {
      this._updateDisabledStatesForRow(rowIndex);
    });
    console.log("Finished updating all disabled states.");
  }

  // --- Utility Methods ---

  _getCoordsFromEvent(event) {
    // ... (same as before)
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const contentX = canvasX + this.scrollLeft;
    const contentY = canvasY + this.scrollTop;
    const { headerHeight, rowNumberWidth, cellWidth, cellHeight } =
      this.options;
    if (contentX < rowNumberWidth || contentY < headerHeight) {
      // Check if click was specifically in row number area
      if (contentX < rowNumberWidth && contentY >= headerHeight) {
        const row = Math.floor((contentY - headerHeight) / cellHeight);
        if (row >= 0 && row < this.data.length) {
          return { row, col: null }; // Indicate row number click
        }
      }
      return { row: null, col: null }; // Header or outside
    }
    const col = Math.floor((contentX - rowNumberWidth) / cellWidth);
    const row = Math.floor((contentY - headerHeight) / cellHeight);
    if (
      row >= 0 &&
      row < this.data.length &&
      col >= 0 &&
      col < this.columns.length
    )
      return { row, col };
    return { row: null, col: null };
  }

  getCellBounds(rowIndex, colIndex) {
    // ... (same as before)
    const { cellWidth, cellHeight, headerHeight, rowNumberWidth } =
      this.options;
    const contentX = rowNumberWidth + colIndex * cellWidth;
    const contentY = headerHeight + rowIndex * cellHeight;
    const viewportX = contentX - this.scrollLeft;
    const viewportY = contentY - this.scrollTop;
    const isVisible =
      viewportX < this.viewportWidth &&
      viewportX + cellWidth > 0 &&
      viewportY < this.viewportHeight &&
      viewportY + cellHeight > 0;
    if (!isVisible) return null;
    return { x: viewportX, y: viewportY, width: cellWidth, height: cellHeight };
  }

  _getFillHandleBounds(rowIndex, colIndex) {
    // ... (same as before)
    const cellBounds = this.getCellBounds(rowIndex, colIndex);
    if (!cellBounds) return null;
    const { fillHandleSize } = this.options;
    const handleX = cellBounds.x + cellBounds.width - fillHandleSize / 2 - 1;
    const handleY = cellBounds.y + cellBounds.height - fillHandleSize / 2 - 1;
    return {
      x: handleX - fillHandleSize / 2,
      y: handleY - fillHandleSize / 2,
      width: fillHandleSize,
      height: fillHandleSize,
    };
  }

  _formatValue(value, type) {
    // ... (same as before)
    if (value === null || value === undefined) return "";
    if (type === "date" && value) {
      try {
        let date =
          value instanceof Date ? value : new Date(value + "T00:00:00Z");
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString();
        }
      } catch (e) {}
    }
    return String(value);
  }

  _formatValueForInput(value, type) {
    // ... (same as before)
    if (value === null || value === undefined) return "";
    if (type === "date") {
      try {
        let date =
          value instanceof Date ? value : new Date(value + "T00:00:00Z");
        if (!isNaN(date.getTime())) {
          let month = (date.getMonth() + 1).toString().padStart(2, "0");
          let day = date.getDate().toString().padStart(2, "0");
          return `${date.getFullYear()}-${month}-${day}`;
        }
      } catch (e) {}
      return "";
    }
    return String(value);
  }

  _parseValueFromInput(value, type) {
    // ... (same as before)
    if (value === "") return null;
    switch (type) {
      case "number":
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
      case "boolean":
        return value.toLowerCase() === "true";
      case "date":
        return value;
      default:
        return value;
    }
  }

  // --- Public API Methods ---
  getData() {
    // Return deep copy excluding hidden disabled fields
    return JSON.parse(
      JSON.stringify(this.data, (key, value) => {
        if (
          typeof key === "string" &&
          key.startsWith(this.DISABLED_FIELD_PREFIX)
        ) {
          return undefined; // Exclude these fields
        }
        return value;
      })
    );
  }

  setData(newData) {
    // Use deep copy and initialize disabled states
    this.data = JSON.parse(JSON.stringify(newData || []));
    this._updateAllDisabledStates(); // Calculate initial disabled states
    this._hideDropdown();
    this._deactivateEditor(false);
    this._calculateDimensions();
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this._calculateVisibleRange();
    this.draw();
  }
  updateCell(rowIndex, colKey, value) {
    // ... (same as before, includes validation)
    if (rowIndex >= 0 && rowIndex < this.data.length && this.schema[colKey]) {
      if (!this.data[rowIndex]) {
        this.data[rowIndex] = {};
      }
      const schemaCol = this.schema[colKey];
      if (this._validateInput(value, schemaCol, colKey)) {
        this.data[rowIndex][colKey] = value;
        this.draw();
      } else {
        console.warn(
          `updateCell: Validation failed for ${colKey}. Value not set.`
        );
      }
    } else {
      console.warn("updateCell: Invalid row index or column key.");
    }
  }
} // End Spreadsheet Class
