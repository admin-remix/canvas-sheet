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
      defaultColumnWidth: 150,
      defaultRowHeight: 30,
      minColumnWidth: 50,
      maxColumnWidth: 500,
      minRowHeight: 20,
      maxRowHeight: 150,
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
      resizeHandleSize: 5,
      isCellDisabled: (rowIndex, colKey, rowData) => false,
      verbose: false,
    };
    this.options = { ...this.options, ...options };

    this.isCellDisabled = this.options.isCellDisabled;
    this.DISABLED_FIELD_PREFIX = "disabled:";

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
    this.activeCell = null;
    this.selectedRows = new Set();
    this.lastClickedRow = null;
    this.isDraggingFillHandle = false;
    this.dragStartCell = null;
    this.dragEndRow = null;
    this.copiedValue = null;
    this.copiedValueType = null;
    this.copiedCell = null;

    // Dynamic Size State
    this.columnWidths = [];
    this.rowHeights = [];

    // Resize State
    this.isResizingColumn = false;
    this.resizingColumnIndex = null;
    this.resizeColumnStartX = null;
    this.isResizingRow = false;
    this.resizingRowIndex = null;
    this.resizeRowStartY = null;

    // --- Initialization ---
    this._setupCanvas();
    this._setupDropdown();
    this._setupEditorInput();
    this.setData(data);
    this._bindEvents();
    this.draw();
  }

  // --- Setup Methods ---

  _setupCanvas() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.container.appendChild(this.canvas);
    this.container.style.position = "relative";
    this.container.tabIndex = -1;
  }

  _setupDropdown() {
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
    this.totalContentWidth = this._getTotalWidth();
    this.totalContentHeight = this._getTotalHeight();
    this.viewportWidth = this.container.clientWidth;
    this.viewportHeight = this.container.clientHeight;

    this.canvas.width = this.totalContentWidth;
    this.canvas.height = this.totalContentHeight;

    this.canvas.style.width = `${this.totalContentWidth}px`;
    this.canvas.style.height = `${this.totalContentHeight}px`;

    this._log("log", "Calculated Dimensions:", {
      totalContentWidth: this.totalContentWidth,
      totalContentHeight: this.totalContentHeight,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
    });

    this._calculateVisibleRange();
  }

  _calculateVisibleRange() {
    const { headerHeight, rowNumberWidth } = this.options;

    let currentX = rowNumberWidth;
    this.visibleColStartIndex = -1;
    this.visibleColEndIndex = this.columns.length - 1;
    for (let col = 0; col < this.columns.length; col++) {
      const colWidth = this.columnWidths[col];
      const colRight = currentX + colWidth;
      if (
        colRight > this.scrollLeft &&
        currentX < this.scrollLeft + this.viewportWidth
      ) {
        if (this.visibleColStartIndex === -1) {
          this.visibleColStartIndex = col;
        }
        this.visibleColEndIndex = col;
      } else if (this.visibleColStartIndex !== -1) {
        break;
      }
      currentX = colRight;
    }
    if (this.visibleColStartIndex === -1) {
      this.visibleColStartIndex = 0;
      this.visibleColEndIndex = -1;
    }

    let currentY = headerHeight;
    this.visibleRowStartIndex = -1;
    this.visibleRowEndIndex = this.data.length - 1;
    for (let row = 0; row < this.data.length; row++) {
      const rowHeight = this.rowHeights[row];
      const rowBottom = currentY + rowHeight;
      if (
        rowBottom > this.scrollTop &&
        currentY < this.scrollTop + this.viewportHeight
      ) {
        if (this.visibleRowStartIndex === -1) {
          this.visibleRowStartIndex = row;
        }
        this.visibleRowEndIndex = row;
      } else if (this.visibleRowStartIndex !== -1) {
        break;
      }
      currentY = rowBottom;
    }
    if (this.visibleRowStartIndex === -1) {
      this.visibleRowStartIndex = 0;
      this.visibleRowEndIndex = -1;
    }

    this._log("log", "Calculated Visible Range:", {
      rows: `${this.visibleRowStartIndex} - ${this.visibleRowEndIndex}`,
      cols: `${this.visibleColStartIndex} - ${this.visibleColEndIndex}`,
    });
  }

  // --- Event Binding ---

  _bindEvents() {
    this.container.addEventListener("scroll", this._handleScroll.bind(this));
    this.canvas.addEventListener(
      "dblclick",
      this._handleDoubleClick.bind(this)
    );
    this.canvas.addEventListener("click", this._handleClick.bind(this));
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
    this.scrollTop = this.container.scrollTop;
    this.scrollLeft = this.container.scrollLeft;
    this._hideDropdown();
    this._deactivateEditor(false);
    this._calculateVisibleRange();
    this.draw();
  }

  _handleResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this._hideDropdown();
      this._deactivateEditor(false);
      this._calculateDimensions();
      this.draw();
    }, 100);
  }

  _handleDoubleClick(event) {
    if (this.isResizingColumn || this.isResizingRow) {
      this._log("log", "Double click ignored due to active resize.");
      return;
    }

    const { row, col } = this._getCoordsFromEvent(event);
    if (row === null || col === null) return;

    const rowData = this.data[row] || {};
    const colKey = this.columns[col];
    if (rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`]) {
      this._log("log", `Edit prevented: Cell ${row},${col} is disabled.`);
      return;
    }

    this.copiedCell = null;
    this.activeCell = { row, col };
    this._clearSelectedRows();
    this._activateEditor(row, col);
  }

  _handleClick(event) {
    if (
      this.isDraggingFillHandle ||
      this.isResizingColumn ||
      this.isResizingRow
    ) {
      this._log("log", "Click ignored due to active drag/resize.");
      return;
    }

    const { row, col } = this._getCoordsFromEvent(event);
    const isCellClick = row !== null && col !== null;
    const isRowNumberClick =
      row !== null &&
      col === null &&
      event.offsetX < this.options.rowNumberWidth;
    let redrawNeeded = false;

    // reset copied cell if clicking on a non-cell area
    if (this.copiedCell && !isCellClick) {
      this.copiedCell = null;
      redrawNeeded = true;
    }

    if (isRowNumberClick) {
      this._handleRowNumberClick(
        row,
        event.shiftKey,
        event.ctrlKey || event.metaKey
      );
      if (this.activeCell) redrawNeeded = true;
      this.activeCell = null;
      if (this.activeEditor) {
        this._deactivateEditor(true);
        redrawNeeded = true;
      } else {
        redrawNeeded = true;
      }
    } else if (isCellClick) {
      if (
        this.activeEditor &&
        (this.activeEditor.row !== row || this.activeEditor.col !== col)
      ) {
        this._deactivateEditor(true);
      }
      if (
        this.dropdown.style.display !== "none" &&
        (!this.activeEditor ||
          this.activeEditor.row !== row ||
          this.activeEditor.col !== col)
      ) {
        this._hideDropdown();
      }
      if (
        !this.activeCell ||
        this.activeCell.row !== row ||
        this.activeCell.col !== col
      ) {
        this.activeCell = { row, col };
        this._clearSelectedRows();
        redrawNeeded = true;
      }
    } else {
      if (this.activeEditor) {
        this._deactivateEditor(true);
        redrawNeeded = true;
      } else if (this.dropdown.style.display !== "none") {
        this._hideDropdown();
      } else if (this.activeCell || this.selectedRows.size > 0) {
        this.activeCell = null;
        this._clearSelectedRows();
        redrawNeeded = true;
      }
    }

    if (redrawNeeded) {
      this.draw();
    }
  }

  _handleRowNumberClick(clickedRow, isShiftKey, isCtrlKey) {
    this._log(
      "log",
      `Row ${clickedRow} clicked. Shift: ${isShiftKey}, Ctrl: ${isCtrlKey}`
    );
    if (isShiftKey && this.lastClickedRow !== null) {
      this.selectedRows.clear();
      const start = Math.min(this.lastClickedRow, clickedRow);
      const end = Math.max(this.lastClickedRow, clickedRow);
      for (let i = start; i <= end; i++) {
        this.selectedRows.add(i);
      }
      this._log(
        "log",
        "Selected rows (Shift):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    } else if (isCtrlKey) {
      if (this.selectedRows.has(clickedRow)) {
        this.selectedRows.delete(clickedRow);
      } else {
        this.selectedRows.add(clickedRow);
      }
      this.lastClickedRow = clickedRow;
      this._log(
        "log",
        "Selected rows (Ctrl):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    } else {
      this.selectedRows.clear();
      this.selectedRows.add(clickedRow);
      this.lastClickedRow = clickedRow;
      this._log(
        "log",
        "Selected rows (Single):",
        Array.from(this.selectedRows).sort((a, b) => a - b)
      );
    }
  }

  _clearSelectedRows() {
    if (this.selectedRows.size > 0) {
      this.selectedRows.clear();
      this.lastClickedRow = null;
    }
  }

  _handleCanvasMouseDown(event) {
    const rect = this.canvas.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    const contentX = viewportX + this.scrollLeft;
    const contentY = viewportY + this.scrollTop;
    const { headerHeight, rowNumberWidth, resizeHandleSize } = this.options;

    if (contentY < headerHeight && contentX > rowNumberWidth) {
      let currentX = rowNumberWidth;
      for (let col = 0; col < this.columns.length; col++) {
        const colWidth = this.columnWidths[col];
        const borderX = currentX + colWidth;
        if (Math.abs(contentX - borderX) <= resizeHandleSize) {
          this._log("log", `Starting column resize for index ${col}`);
          this.isResizingColumn = true;
          this.resizingColumnIndex = col;
          this.resizeColumnStartX = event.clientX;
          this.canvas.style.cursor = "col-resize";
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        currentX = borderX;
      }
    }

    if (contentX < rowNumberWidth && contentY > headerHeight) {
      let currentY = headerHeight;
      for (let row = 0; row < this.data.length; row++) {
        const rowHeight = this.rowHeights[row];
        const borderY = currentY + rowHeight;
        if (Math.abs(contentY - borderY) <= resizeHandleSize) {
          this._log("log", `Starting row resize for index ${row}`);
          this.isResizingRow = true;
          this.resizingRowIndex = row;
          this.resizeRowStartY = event.clientY;
          this.canvas.style.cursor = "row-resize";
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        currentY = borderY;
      }
    }

    if (this.activeCell && !this.isResizingColumn && !this.isResizingRow) {
      const handleBounds = this._getFillHandleBounds(
        this.activeCell.row,
        this.activeCell.col
      );
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
        this._log(
          "log",
          "Started dragging fill handle from",
          this.dragStartCell
        );
        return;
      }
    }
  }

  _handleDocumentMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    const contentX = viewportX + this.scrollLeft;
    const contentY = viewportY + this.scrollTop;
    const {
      headerHeight,
      rowNumberWidth,
      resizeHandleSize,
      minColumnWidth,
      maxColumnWidth,
      minRowHeight,
      maxRowHeight,
    } = this.options;

    let newCursor = "default";

    if (this.isResizingColumn) {
      newCursor = "col-resize";
      const deltaX = event.clientX - this.resizeColumnStartX;
      const originalWidth = this.columnWidths[this.resizingColumnIndex];
      let newWidth = originalWidth + deltaX;

      newWidth = Math.max(minColumnWidth, Math.min(newWidth, maxColumnWidth));

      if (newWidth !== originalWidth) {
        this.columnWidths[this.resizingColumnIndex] = newWidth;
        this.resizeColumnStartX = event.clientX;
        this._calculateDimensions();
        this.draw();
      }
    } else if (this.isResizingRow) {
      newCursor = "row-resize";
      const deltaY = event.clientY - this.resizeRowStartY;
      const originalHeight = this.rowHeights[this.resizingRowIndex];
      let newHeight = originalHeight + deltaY;

      newHeight = Math.max(minRowHeight, Math.min(newHeight, maxRowHeight));

      if (newHeight !== originalHeight) {
        this.rowHeights[this.resizingRowIndex] = newHeight;
        this.resizeRowStartY = event.clientY;
        this._calculateDimensions();
        this.draw();
      }
    } else {
      if (contentY < headerHeight && contentX > rowNumberWidth) {
        let currentX = rowNumberWidth;
        for (let col = 0; col < this.columns.length; col++) {
          const borderX = currentX + this.columnWidths[col];
          if (Math.abs(contentX - borderX) <= resizeHandleSize) {
            newCursor = "col-resize";
            break;
          }
          currentX = borderX;
          if (currentX > contentX + resizeHandleSize) break;
        }
      } else if (
        newCursor === "default" &&
        contentX < rowNumberWidth &&
        contentY > headerHeight
      ) {
        let currentY = headerHeight;
        for (let row = 0; row < this.data.length; row++) {
          const borderY = currentY + this.rowHeights[row];
          if (Math.abs(contentY - borderY) <= resizeHandleSize) {
            newCursor = "row-resize";
            break;
          }
          currentY = borderY;
          if (currentY > contentY + resizeHandleSize) break;
        }
      } else if (
        newCursor === "default" &&
        this.activeCell &&
        !this.activeEditor
      ) {
        const handleBounds = this._getFillHandleBounds(
          this.activeCell.row,
          this.activeCell.col
        );
        if (
          handleBounds &&
          viewportX >= handleBounds.x &&
          viewportX <= handleBounds.x + handleBounds.width &&
          viewportY >= handleBounds.y &&
          viewportY <= handleBounds.y + handleBounds.height
        ) {
          newCursor = "crosshair";
        }
      }
    }

    if (this.canvas.style.cursor !== newCursor) {
      this.canvas.style.cursor = newCursor;
    }

    if (this.isDraggingFillHandle) {
      if (this.canvas.style.cursor !== "crosshair") {
        this.canvas.style.cursor = "crosshair";
      }
      const { row } = this._getCoordsFromEvent(event);
      if (row !== null && row >= this.dragStartCell.row) {
        if (row !== this.dragEndRow) {
          this.dragEndRow = row;
          this.draw();
        }
      } else if (row !== null && row < this.dragStartCell.row) {
        if (this.dragEndRow !== this.dragStartCell.row) {
          this.dragEndRow = this.dragStartCell.row;
          this.draw();
        }
      }
    }
  }

  _handleDocumentMouseUp(event) {
    if (this.isResizingColumn) {
      this._log(
        "log",
        `Finished column resize for index ${
          this.resizingColumnIndex
        }. New width: ${this.columnWidths[this.resizingColumnIndex]}`
      );
      this.isResizingColumn = false;
      this.resizingColumnIndex = null;
      this.resizeColumnStartX = null;
    }

    if (this.isResizingRow) {
      this._log(
        "log",
        `Finished row resize for index ${this.resizingRowIndex}. New height: ${
          this.rowHeights[this.resizingRowIndex]
        }`
      );
      this.isResizingRow = false;
      this.resizingRowIndex = null;
      this.resizeRowStartY = null;
    }

    if (this.isDraggingFillHandle) {
      this._log("log", "Finished dragging fill handle to row", this.dragEndRow);
      this._performFillDown();
      this.isDraggingFillHandle = false;
      this.dragStartCell = null;
      this.dragEndRow = null;
      this.draw();
    }
  }

  _handleGlobalMouseDown(event) {
    if (this.isDraggingFillHandle) return;
    if (!this.container.contains(event.target)) {
      let needsRedraw = false;
      if (this.activeEditor) {
        this._deactivateEditor(true);
      } else if (this.dropdown.style.display !== "none") {
        this._hideDropdown();
      } else if (
        this.activeCell ||
        this.selectedRows.size > 0 ||
        this.copiedCell
      ) {
        this.activeCell = null;
        this._clearSelectedRows();
        this.copiedCell = null;
        needsRedraw = true;
      }
      if (needsRedraw) {
        this.draw();
      }
    }
  }

  _handleDocumentKeyDown(event) {
    const isCtrl = event.ctrlKey || event.metaKey;

    if (this.activeEditor || this.dropdown.style.display !== "none") {
      return;
    }

    if (isCtrl && event.key === "c") {
      if (this.activeCell) {
        const { row, col } = this.activeCell;
        const colKey = this.columns[col];
        this.copiedValue = this.data[row]?.[colKey];
        this.copiedValueType = this.schema[colKey]?.type;
        this.copiedCell = { ...this.activeCell };
        this._log(
          "log",
          `Copied value: ${this.copiedValue} (Type: ${this.copiedValueType}) from cell ${row},${col}`
        );
        this.draw();
        event.preventDefault();
      }
    } else if (isCtrl && event.key === "v") {
      if (this.activeCell && this.copiedValue !== null) {
        this._performPaste();
        event.preventDefault();
      }
    } else if (event.key === "Delete") {
      if (this.selectedRows.size > 0) {
        this._deleteSelectedRows();
        event.preventDefault();
      }
    }
  }

  // --- Drawing Methods ---

  draw() {
    this.ctx.save();
    this.ctx.font = this.options.font;
    this._clearCanvas();
    this.ctx.translate(-this.scrollLeft, -this.scrollTop);
    this._drawHeaders();
    this._drawRowNumbers();
    this._drawCells();
    this._drawGridLines();
    this._drawCopiedCellHighlight();
    this._drawHighlight();
    this._drawDragRange();
    this.ctx.restore();
    this._drawCornerBox();
  }

  _clearCanvas() {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(
      this.scrollLeft,
      this.scrollTop,
      this.viewportWidth,
      this.viewportHeight
    );
  }

  _drawCornerBox() {
    const { rowNumberWidth, headerHeight, gridLineColor, rowNumberBgColor } =
      this.options;
    const x = this.scrollLeft;
    const y = this.scrollTop;
    this.ctx.save();
    this.ctx.fillStyle = rowNumberBgColor;
    this.ctx.fillRect(x, y, rowNumberWidth, headerHeight);
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.strokeRect(x + 0.5, y + 0.5, rowNumberWidth, headerHeight);
    this.ctx.restore();
  }

  _drawHeaders() {
    const {
      headerHeight,
      rowNumberWidth,
      headerFont,
      headerBgColor,
      headerTextColor,
      gridLineColor,
    } = this.options;

    this.ctx.save();

    const headerAreaX = rowNumberWidth;
    const headerAreaY = 0;
    const headerAreaWidth = this._getTotalWidth() - rowNumberWidth;
    const headerAreaHeight = headerHeight;

    this.ctx.beginPath();
    this.ctx.rect(
      Math.max(headerAreaX, rowNumberWidth + this.scrollLeft),
      headerAreaY,
      this.viewportWidth - rowNumberWidth,
      headerAreaHeight
    );
    this.ctx.clip();

    this.ctx.fillStyle = headerBgColor;
    this.ctx.fillRect(
      headerAreaX,
      headerAreaY,
      headerAreaWidth,
      headerAreaHeight
    );

    this.ctx.font = headerFont;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillStyle = headerTextColor;

    let currentX = this._getColumnLeft(this.visibleColStartIndex);
    for (
      let col = this.visibleColStartIndex;
      col <= this.visibleColEndIndex;
      col++
    ) {
      if (col < 0 || col >= this.columns.length) continue;

      const colKey = this.columns[col];
      const schemaCol = this.schema[colKey];
      const headerText = schemaCol?.label || colKey;
      const colWidth = this.columnWidths[col];

      this.ctx.fillText(
        headerText,
        currentX + colWidth / 2,
        headerAreaY + headerAreaHeight / 2,
        colWidth - 10
      );

      this.ctx.strokeStyle = gridLineColor;
      this.ctx.beginPath();
      this.ctx.moveTo(currentX + colWidth - 0.5, headerAreaY);
      this.ctx.lineTo(
        currentX + colWidth - 0.5,
        headerAreaY + headerAreaHeight
      );
      this.ctx.stroke();

      currentX += colWidth;
    }

    this.ctx.restore();

    this.ctx.strokeStyle = gridLineColor;
    this.ctx.beginPath();
    this.ctx.moveTo(rowNumberWidth, headerHeight - 0.5);
    this.ctx.lineTo(this._getTotalWidth(), headerHeight - 0.5);
    this.ctx.stroke();
  }

  _drawRowNumbers() {
    const {
      headerHeight,
      rowNumberWidth,
      font,
      rowNumberBgColor,
      selectedRowNumberBgColor,
      textColor,
      gridLineColor,
    } = this.options;

    this.ctx.save();

    const rowNumAreaX = 0;
    const rowNumAreaY = headerHeight;
    const rowNumAreaWidth = rowNumberWidth;
    const rowNumAreaHeight = this._getTotalHeight() - headerHeight;

    this.ctx.beginPath();
    this.ctx.rect(
      rowNumAreaX,
      Math.max(rowNumAreaY, headerHeight + this.scrollTop),
      rowNumAreaWidth,
      this.viewportHeight - headerHeight
    );
    this.ctx.clip();

    this.ctx.fillStyle = rowNumberBgColor;
    this.ctx.fillRect(
      rowNumAreaX,
      rowNumAreaY,
      rowNumAreaWidth,
      rowNumAreaHeight
    );

    this.ctx.font = font;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    let currentY = this._getRowTop(this.visibleRowStartIndex);
    for (
      let row = this.visibleRowStartIndex;
      row <= this.visibleRowEndIndex;
      row++
    ) {
      if (row < 0 || row >= this.data.length) continue;

      const rowHeight = this.rowHeights[row];

      if (this.selectedRows.has(row)) {
        this.ctx.fillStyle = selectedRowNumberBgColor;
        this.ctx.fillRect(rowNumAreaX, currentY, rowNumAreaWidth, rowHeight);
      }

      this.ctx.fillStyle = textColor;
      this.ctx.fillText(
        (row + 1).toString(),
        rowNumAreaX + rowNumAreaWidth / 2,
        currentY + rowHeight / 2
      );

      this.ctx.strokeStyle = gridLineColor;
      this.ctx.beginPath();
      this.ctx.moveTo(rowNumAreaX, currentY + rowHeight - 0.5);
      this.ctx.lineTo(
        rowNumAreaX + rowNumAreaWidth,
        currentY + rowHeight - 0.5
      );
      this.ctx.stroke();

      currentY += rowHeight;
    }
    this.ctx.restore();

    this.ctx.strokeStyle = gridLineColor;
    this.ctx.beginPath();
    this.ctx.moveTo(rowNumberWidth - 0.5, headerHeight);
    this.ctx.lineTo(rowNumberWidth - 0.5, this._getTotalHeight());
    this.ctx.stroke();
  }

  _drawCells() {
    const {
      headerHeight,
      rowNumberWidth,
      font,
      textColor,
      disabledCellBgColor,
      disabledTextColor,
    } = this.options;

    this.ctx.save();

    const gridAreaX = rowNumberWidth;
    const gridAreaY = headerHeight;
    const gridAreaWidth = this._getTotalWidth() - rowNumberWidth;
    const gridAreaHeight = this._getTotalHeight() - headerHeight;

    this.ctx.beginPath();
    this.ctx.rect(
      gridAreaX,
      gridAreaY,
      this.viewportWidth - rowNumberWidth,
      this.viewportHeight - headerHeight
    );
    this.ctx.clip();

    this.ctx.font = font;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "middle";

    let currentY = this._getRowTop(this.visibleRowStartIndex);
    for (
      let row = this.visibleRowStartIndex;
      row <= this.visibleRowEndIndex;
      row++
    ) {
      if (row < 0 || row >= this.data.length) continue;
      const rowData = this.data[row] || {};
      const rowHeight = this.rowHeights[row];

      let currentX = this._getColumnLeft(this.visibleColStartIndex);
      for (
        let col = this.visibleColStartIndex;
        col <= this.visibleColEndIndex;
        col++
      ) {
        if (col < 0 || col >= this.columns.length) continue;
        const colWidth = this.columnWidths[col];

        if (
          this.activeEditor &&
          this.activeEditor.row === row &&
          this.activeEditor.col === col
        ) {
          // Skip drawing the cell if the editor is active but move the currentX to the next cell
          currentX += colWidth;
          continue;
        }

        const colKey = this.columns[col];
        const cellValue = rowData[colKey];
        const schemaCol = this.schema[colKey];
        const isDisabledCell =
          !!rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`];

        this.ctx.fillStyle = isDisabledCell ? disabledCellBgColor : "#ffffff";
        this.ctx.fillRect(currentX, currentY, colWidth, rowHeight);

        this.ctx.fillStyle = isDisabledCell ? disabledTextColor : textColor;
        let displayValue = this._formatValue(cellValue, schemaCol?.type);

        if (
          schemaCol?.type === "select" &&
          schemaCol.values &&
          cellValue !== undefined &&
          cellValue !== null
        ) {
          const selectedOption = schemaCol.values.find(
            (v) => v.id === cellValue
          );
          displayValue = selectedOption ? selectedOption.name : "";
        } else if (schemaCol?.type === "boolean") {
          displayValue =
            cellValue === true ? "True" : cellValue === false ? "False" : "";
        }

        const textPadding = 5;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(
          currentX + textPadding,
          currentY,
          colWidth - textPadding * 2,
          rowHeight
        );
        this.ctx.clip();
        this.ctx.fillText(
          displayValue,
          currentX + textPadding,
          currentY + rowHeight / 2
        );
        this.ctx.restore();

        currentX += colWidth;
      }
      currentY += rowHeight;
    }
    this.ctx.restore();
  }

  _drawGridLines() {
    const { headerHeight, rowNumberWidth, gridLineColor } = this.options;
    const totalWidth = this._getTotalWidth();
    const totalHeight = this._getTotalHeight();

    this.ctx.save();
    this.ctx.strokeStyle = gridLineColor;
    this.ctx.lineWidth = 1;

    let currentX = rowNumberWidth;
    for (let col = 0; col <= this.columns.length; col++) {
      const lineX = Math.round(currentX) - 0.5;
      if (
        lineX >= this.scrollLeft &&
        lineX <= this.scrollLeft + this.viewportWidth + rowNumberWidth
      ) {
        this.ctx.beginPath();
        this.ctx.moveTo(lineX, headerHeight);
        this.ctx.lineTo(lineX, totalHeight);
        this.ctx.stroke();
      }
      if (col < this.columns.length) {
        currentX += this.columnWidths[col];
      }
      if (currentX > this.scrollLeft + this.viewportWidth + rowNumberWidth)
        break;
    }

    let currentY = headerHeight;
    for (let row = 0; row <= this.data.length; row++) {
      const lineY = Math.round(currentY) - 0.5;
      if (
        lineY >= this.scrollTop &&
        lineY <= this.scrollTop + this.viewportHeight + headerHeight
      ) {
        this.ctx.beginPath();
        this.ctx.moveTo(rowNumberWidth, lineY);
        this.ctx.lineTo(totalWidth, lineY);
        this.ctx.stroke();
      }
      if (row < this.data.length) {
        currentY += this.rowHeights[row];
      }
      if (currentY > this.scrollTop + this.viewportHeight + headerHeight) break;
    }

    this.ctx.restore();
  }

  _drawHighlight() {
    if (
      !this.activeCell ||
      this.isDraggingFillHandle ||
      this.isResizingColumn ||
      this.isResizingRow
    )
      return;

    const { row, col } = this.activeCell;
    const bounds = this.getCellBounds(row, col);
    if (!bounds) return;

    const { highlightBorderColor, fillHandleColor, fillHandleSize } =
      this.options;
    const { x, y, width, height } = bounds;

    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor;
    this.ctx.lineWidth = 2;

    this.ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

    if (!this.activeEditor) {
      const handleCenterX = x + width - 1;
      const handleCenterY = y + height - 1;

      this.ctx.fillStyle = fillHandleColor;
      this.ctx.beginPath();
      this.ctx.arc(
        handleCenterX,
        handleCenterY,
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
    if (
      !this.isDraggingFillHandle ||
      this.dragEndRow === null ||
      this.dragEndRow === this.dragStartCell.row
    )
      return;

    const { dragRangeBorderColor } = this.options;
    const { row: startRow, col: startCol } = this.dragStartCell;
    const endRow = this.dragEndRow;

    const startColWidth = this.columnWidths[startCol];
    const startColX = this._getColumnLeft(startCol);

    const startRowY = this._getRowTop(startRow);
    const dragStartY = startRowY + this.rowHeights[startRow];

    let dragRangeHeight = 0;
    for (let r = startRow + 1; r <= endRow; r++) {
      if (r >= this.data.length) break;
      dragRangeHeight += this.rowHeights[r];
    }

    if (dragRangeHeight <= 0) return;

    const viewportX = startColX - this.scrollLeft;
    const viewportY = dragStartY - this.scrollTop;

    this.ctx.save();
    this.ctx.strokeStyle = dragRangeBorderColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 2]);

    this.ctx.strokeRect(
      viewportX + 0.5,
      viewportY + 0.5,
      startColWidth - 1,
      dragRangeHeight - 1
    );

    this.ctx.restore();
  }

  _drawCopiedCellHighlight() {
    if (!this.copiedCell) return;

    const { row, col } = this.copiedCell;
    const bounds = this.getCellBounds(row, col);
    if (!bounds) return;

    const { highlightBorderColor } = this.options;
    const { x, y, width, height } = bounds;

    this.ctx.save();
    this.ctx.strokeStyle = highlightBorderColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 2]);

    this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    this.ctx.restore();
  }

  // --- Cell Editing and Dropdown Logic ---

  _activateEditor(rowIndex, colIndex) {
    const rowData = this.data[rowIndex] || {};
    const colKey = this.columns[colIndex];
    if (rowData[`${this.DISABLED_FIELD_PREFIX}${colKey}`]) {
      this._log(
        "log",
        `Edit prevented: Cell ${rowIndex},${colIndex} is disabled.`
      );
      return;
    }

    if (this.activeEditor) {
      this._deactivateEditor(true);
    }
    this._hideDropdown();
    const schemaCol = this.schema[colKey];
    const cellValue = this.data[rowIndex]?.[colKey];
    const bounds = this.getCellBounds(rowIndex, colIndex);
    if (!bounds) {
      this._log(
        "warn",
        `Cannot activate editor: Cell ${rowIndex},${colIndex} bounds not found (likely not visible).`
      );
      return;
    }

    this.activeEditor = {
      row: rowIndex,
      col: colIndex,
      type: schemaCol?.type,
      originalValue: cellValue,
    };

    const {
      x: editorX,
      y: editorY,
      width: editorWidth,
      height: editorHeight,
    } = bounds;

    if (schemaCol?.type === "select" || schemaCol?.type === "boolean") {
      this._showDropdown(
        rowIndex,
        colIndex,
        schemaCol,
        editorX,
        editorY,
        editorWidth,
        editorHeight
      );
    } else {
      this.editorInput.style.display = "block";
      this.editorInput.style.left = `${editorX}px`;
      this.editorInput.style.top = `${editorY}px`;
      this.editorInput.style.width = `${editorWidth}px`;
      this.editorInput.style.height = `${editorHeight}px`;
      this.editorInput.style.font = this.options.font;

      if (schemaCol?.type === "number") {
        this.editorInput.type = "number";
        this.editorInput.step = schemaCol.decimal === false ? "1" : "any";
      } else if (schemaCol?.type === "email") {
        this.editorInput.type = "email";
      } else if (schemaCol?.type === "date") {
        this.editorInput.type = "date";
      } else {
        this.editorInput.type = "text";
      }

      this.editorInput.value = this._formatValueForInput(
        cellValue,
        schemaCol?.type
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
    const colKey = this.columns[col];

    if (type === "select" || type === "boolean") {
      this._hideDropdown();
      valueChanged = this.data[row]?.[colKey] !== originalValue;
    } else {
      if (saveChanges) {
        const newValueRaw = this.editorInput.value;
        const schemaCol = this.schema[colKey];
        const newValue = this._parseValueFromInput(
          newValueRaw,
          schemaCol?.type
        );
        let isValid = this._validateInput(newValue, schemaCol, colKey);
        if (isValid && newValue !== originalValue) {
          if (!this.data[row]) {
            this.data[row] = {};
          }
          this.data[row][colKey] = newValue;
          valueChanged = true;
        } else if (!isValid) {
          this._log(
            "log",
            "Change not saved due to validation error or no change."
          );
        }
      }
      this.editorInput.style.display = "none";
      this.editorInput.value = "";
    }

    this.activeEditor = null;

    if (valueChanged) {
      this._updateDisabledStatesForRow(row);
    }

    this.draw();
  }

  _validateInput(value, schemaCol, colKey) {
    if (!schemaCol) return true;
    if (
      schemaCol.required &&
      (value === null || value === undefined || value === "")
    ) {
      this._log("warn", `Validation failed: Column "${colKey}" is required.`);
      return false;
    }
    if (
      schemaCol.type === "text" &&
      schemaCol.maxlength &&
      typeof value === "string" &&
      value.length > schemaCol.maxlength
    ) {
      this._log(
        "warn",
        `Validation failed: Column "${colKey}" exceeds max length of ${schemaCol.maxlength}.`
      );
      return false;
    }
    if (
      schemaCol.type === "email" &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      this._log(
        "warn",
        `Validation failed: Invalid email format for column "${colKey}".`
      );
      return false;
    }
    return true;
  }

  _handleEditorBlur(event) {
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
      this._log("warn", "Could not find next non-disabled cell in direction.");
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
    } else {
      this._log(
        "warn",
        `Dropdown requested for non-dropdown type: ${schemaCol.type}`
      );
      return;
    }

    this.dropdownItems.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "spreadsheet-dropdown-item";
      li.textContent = item.name;
      li.dataset.index = index;
      li.dataset.value = String(
        item.id === null || item.id === undefined ? "" : item.id
      );
      this.dropdownList.appendChild(li);
    });

    this.dropdown.style.display = "block";
    this.dropdown.style.left = `${boundsX}px`;
    this.dropdown.style.top = `${boundsY + boundsHeight}px`;
    this.dropdown.style.minWidth = `${boundsWidth}px`;

    requestAnimationFrame(() => {
      const dropdownRect = this.dropdown.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();

      if (
        dropdownRect.bottom > containerRect.bottom &&
        boundsY >= dropdownRect.height
      ) {
        this.dropdown.style.top = `${boundsY - dropdownRect.height}px`;
      }
      if (dropdownRect.right > containerRect.right) {
        const newLeft = containerRect.right - dropdownRect.width - 5;
        this.dropdown.style.left = `${Math.max(0, newLeft)}px`;
      }
      if (dropdownRect.left < containerRect.left) {
        this.dropdown.style.left = `${containerRect.left}px`;
      }
      if (dropdownRect.top < containerRect.top) {
        this.dropdown.style.top = `${containerRect.top}px`;
      }
    });

    this.dropdownSearchInput.value = "";
    this._filterDropdown("");
    this.dropdownSearchInput.focus();
    this.highlightedDropdownIndex = -1;
    this._updateDropdownHighlight(
      Array.from(this.dropdownList.querySelectorAll("li:not(.hidden)"))
    );
  }

  _hideDropdown() {
    if (this.dropdown) {
      this.dropdown.style.display = "none";
      this.highlightedDropdownIndex = -1;
    }
  }

  _handleDropdownSearch() {
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
    const items = this.dropdownList.querySelectorAll("li");
    items.forEach((item) => {
      const itemText = item.textContent.toLowerCase();
      const isVisible = itemText.includes(searchTerm);
      item.classList.toggle("hidden", !isVisible);
    });
  }

  _handleDropdownKeyDown(event) {
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
    visibleItems.forEach((item, index) => {
      const isHighlighted = index === this.highlightedDropdownIndex;
      item.classList.toggle("highlighted", isHighlighted);
      if (isHighlighted) {
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  _handleDropdownItemClick(event) {
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
      this._deactivateEditor(false);
      this.activeCell = null;
    }
  }

  // --- Fill Handle, Copy/Paste, Delete, Disable Logic ---

  _performFillDown() {
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
        !!this.data[row]?.[`${this.DISABLED_FIELD_PREFIX}${colKey}`];

      if (isDisabledCell) {
        this._log("log", `Skipping fill for disabled cell ${row},${startCol}`);
        continue;
      }
      if (targetSchema?.type !== sourceType) {
        this._log("log", `Skipping fill for row ${row}: Type mismatch`);
        continue;
      }

      if (!this.data[row]) {
        this.data[row] = {};
      }
      if (this.data[row][colKey] !== sourceValue) {
        this.data[row][colKey] = sourceValue;
        this._updateDisabledStatesForRow(row);
        changed = true;
      }
    }
  }

  _performPaste() {
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
      !!this.data[targetRow]?.[`${this.DISABLED_FIELD_PREFIX}${targetColKey}`];

    if (isDisabledCell) {
      this._log(
        "log",
        `Paste cancelled: Target cell ${targetRow},${targetCol} is disabled.`
      );
      return;
    }
    if (targetType !== this.copiedValueType) {
      this._log("log", `Paste cancelled: Type mismatch`);
      return;
    }
    if (!this._validateInput(this.copiedValue, targetSchema, targetColKey)) {
      this._log("log", `Paste cancelled: Copied value failed validation.`);
      return;
    }

    if (!this.data[targetRow]) {
      this.data[targetRow] = {};
    }
    if (this.data[targetRow][targetColKey] !== this.copiedValue) {
      this.data[targetRow][targetColKey] = this.copiedValue;
      this._updateDisabledStatesForRow(targetRow);
      this.copiedCell = null;
      this.draw();
    } else {
      this.copiedCell = null;
      this.draw();
    }
  }

  _deleteSelectedRows() {
    if (this.selectedRows.size === 0) return;

    const rowsToDelete = Array.from(this.selectedRows).sort((a, b) => b - a);
    this._log("log", "Deleting rows:", rowsToDelete);

    rowsToDelete.forEach((rowIndex) => {
      if (rowIndex >= 0 && rowIndex < this.data.length) {
        this.data.splice(rowIndex, 1);
        this.rowHeights.splice(rowIndex, 1);
      }
    });

    this.selectedRows.clear();
    this.lastClickedRow = null;
    this.activeCell = null;
    this.copiedCell = null;
    this._calculateDimensions();
    this.draw();
  }

  _updateDisabledStatesForRow(rowIndex) {
    if (rowIndex < 0 || rowIndex >= this.data.length) return;
    const rowData = this.data[rowIndex];
    if (!rowData) return;

    let changed = false;
    this.columns.forEach((colKey) => {
      const disabledKey = `${this.DISABLED_FIELD_PREFIX}${colKey}`;
      const currentDisabledState = !!rowData[disabledKey];
      const newDisabledState = !!this.isCellDisabled(rowIndex, colKey, rowData);

      if (currentDisabledState !== newDisabledState) {
        rowData[disabledKey] = newDisabledState;
        changed = true;
      }
    });
    return changed;
  }

  _updateAllDisabledStates() {
    this._log("log", "Updating all disabled states...");
    this.data.forEach((_, rowIndex) => {
      this._updateDisabledStatesForRow(rowIndex);
    });
    this._log("log", "Finished updating all disabled states.");
  }

  // --- Utility Methods ---

  _getCoordsFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const contentX = canvasX + this.scrollLeft;
    const contentY = canvasY + this.scrollTop;
    const { headerHeight, rowNumberWidth } = this.options;

    let targetRow = null;
    let targetCol = null;

    if (contentY >= headerHeight) {
      let currentY = headerHeight;
      for (let i = 0; i < this.data.length; i++) {
        const rowHeight = this.rowHeights[i];
        if (contentY >= currentY && contentY < currentY + rowHeight) {
          targetRow = i;
          break;
        }
        currentY += rowHeight;
        if (currentY > contentY) break;
      }
    }

    if (targetRow !== null && contentX >= rowNumberWidth) {
      let currentX = rowNumberWidth;
      for (let j = 0; j < this.columns.length; j++) {
        const colWidth = this.columnWidths[j];
        if (contentX >= currentX && contentX < currentX + colWidth) {
          targetCol = j;
          break;
        }
        currentX += colWidth;
        if (currentX > contentX) break;
      }
    } else if (targetRow !== null && contentX < rowNumberWidth) {
      targetCol = null;
    } else {
      targetRow = null;
      targetCol = null;
    }

    return { row: targetRow, col: targetCol };
  }

  getCellBounds(rowIndex, colIndex) {
    if (
      rowIndex < 0 ||
      rowIndex >= this.data.length ||
      colIndex < 0 ||
      colIndex >= this.columns.length
    ) {
      return null;
    }

    const cellWidth = this.columnWidths[colIndex];
    const cellHeight = this.rowHeights[rowIndex];
    const contentX = this._getColumnLeft(colIndex);
    const contentY = this._getRowTop(rowIndex);

    const viewportX = contentX - this.scrollLeft;
    const viewportY = contentY - this.scrollTop;

    const isPotentiallyVisible =
      viewportX < this.viewportWidth &&
      viewportX + cellWidth > 0 &&
      viewportY < this.viewportHeight &&
      viewportY + cellHeight > 0;

    if (!isPotentiallyVisible) return null;

    return { x: viewportX, y: viewportY, width: cellWidth, height: cellHeight };
  }

  _getFillHandleBounds(rowIndex, colIndex) {
    const cellBounds = this.getCellBounds(rowIndex, colIndex);
    if (!cellBounds) return null;

    const { fillHandleSize } = this.options;
    const handleCenterX = cellBounds.x + cellBounds.width - 1;
    const handleCenterY = cellBounds.y + cellBounds.height - 1;

    return {
      x: handleCenterX - fillHandleSize / 2,
      y: handleCenterY - fillHandleSize / 2,
      width: fillHandleSize,
      height: fillHandleSize,
    };
  }

  _formatValue(value, type) {
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

  _log(type, ...args) {
    if (!this.options.verbose || !["log", "warn", "error"].includes(type))
      return;
    console[type](...args);
  }

  // --- Public API Methods ---

  getData() {
    return JSON.parse(
      JSON.stringify(this.data, (key, value) => {
        if (
          typeof key === "string" &&
          key.startsWith(this.DISABLED_FIELD_PREFIX)
        ) {
          return undefined;
        }
        return value;
      })
    );
  }

  setData(newData) {
    this.data = JSON.parse(JSON.stringify(newData || []));
    this._initializeSizes(this.data.length);
    this._updateAllDisabledStates();
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
    if (rowIndex >= 0 && rowIndex < this.data.length && this.schema[colKey]) {
      if (!this.data[rowIndex]) {
        this.data[rowIndex] = {};
      }
      const schemaCol = this.schema[colKey];
      if (this._validateInput(value, schemaCol, colKey)) {
        this.data[rowIndex][colKey] = value;
        this.draw();
      } else {
        this._log(
          "warn",
          `updateCell: Validation failed for ${colKey}. Value not set.`
        );
      }
    } else {
      this._log("warn", "updateCell: Invalid row index or column key.");
    }
  }

  // --- Helper Methods ---

  _getColumnLeft(colIndex) {
    let left = this.options.rowNumberWidth;
    for (let i = 0; i < colIndex; i++) {
      left += this.columnWidths[i] || this.options.defaultColumnWidth;
    }
    return left;
  }

  _getRowTop(rowIndex) {
    let top = this.options.headerHeight;
    for (let i = 0; i < rowIndex; i++) {
      top += this.rowHeights[i] || this.options.defaultRowHeight;
    }
    return top;
  }

  _getTotalWidth() {
    let totalWidth = this.options.rowNumberWidth;
    this.columnWidths.forEach((width) => (totalWidth += width));
    return totalWidth;
  }

  _getTotalHeight() {
    let totalHeight = this.options.headerHeight;
    this.rowHeights.forEach((height) => (totalHeight += height));
    return totalHeight;
  }

  _initializeSizes(rowCount) {
    this.columnWidths = this.columns.map((colKey, index) => {
      return this.options.defaultColumnWidth;
    });

    this.rowHeights = Array(rowCount).fill(this.options.defaultRowHeight);

    this._log("log", "Initialized column widths:", this.columnWidths);
    this._log("log", "Initialized row heights:", this.rowHeights);
  }
}
