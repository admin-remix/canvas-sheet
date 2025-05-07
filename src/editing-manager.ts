import {
  RequiredSpreadsheetOptions,
  ColumnSchema,
  DropdownItem,
} from "./types";
import { StateManager } from "./state-manager";
import { DomManager } from "./dom-manager";
import { Renderer } from "./renderer";
import { InteractionManager } from "./interaction-manager";
import {
  formatValueForInput,
  parseValueFromInput,
  validateInput,
  log,
  debounce,
} from "./utils";
import { ERROR_FIELD_PREFIX, LOADING_FIELD_PREFIX } from "./config";

export class EditingManager {
  private container: HTMLElement;
  private options: RequiredSpreadsheetOptions;
  private stateManager: StateManager;
  private domManager: DomManager;
  private renderer: Renderer;
  private interactionManager: InteractionManager; // Needed for moving active cell

  // DOM Elements specific to editing
  private editorInput: HTMLInputElement;
  private editorTextarea: HTMLTextAreaElement;
  private dropdown: HTMLDivElement;
  private dropdownSearchInput: HTMLInputElement;
  private dropdownList: HTMLUListElement;
  private dropdownFooter: HTMLDivElement;
  private dropdownDoneButton: HTMLButtonElement;

  // Dropdown state
  private dropdownItems: DropdownItem[] = [];
  private highlightedDropdownIndex: number = -1;
  private selectedDropdownItems: Set<any> = new Set(); // Track multi-selected items
  private DEFAULT_SAFE_MARGIN = 50;
  private debouncedLazySearch: (searchTerm: string) => void;

  constructor(
    container: HTMLElement,
    options: RequiredSpreadsheetOptions,
    stateManager: StateManager,
    domManager: DomManager,
    renderer: Renderer,
    interactionManager: InteractionManager
  ) {
    this.container = container;
    this.options = options;
    this.stateManager = stateManager;
    this.domManager = domManager;
    this.renderer = renderer;
    this.interactionManager = interactionManager;

    // Get references to DOM elements created by DomManager
    this.editorInput = this.domManager.getEditorInput();
    this.editorTextarea = this.domManager.getEditorTextarea();
    const dropdownElements = this.domManager.getDropdownElements();
    this.dropdown = dropdownElements.dropdown;
    this.dropdownSearchInput = dropdownElements.searchInput;
    this.dropdownList = dropdownElements.list;
    this.dropdownFooter = dropdownElements.footer;
    this.dropdownDoneButton = dropdownElements.doneButton;

    // Initialize debounced search with 300ms delay
    this.debouncedLazySearch = debounce(
      this._handleLazySearch.bind(this),
      this.options.lazySearchDebounceTime
    );
  }

  public bindInternalEvents(): void {
    // Editor Input Events
    this.editorInput.addEventListener(
      "keydown",
      this._handleEditorKeyDown.bind(this)
    );

    // Textarea Events
    this.editorTextarea.addEventListener(
      "keydown",
      this._handleEditorKeyDown.bind(this)
    );

    // Dropdown Events
    this.dropdown.addEventListener("mousedown", (e) => e.stopPropagation()); // Prevent closing dropdown when clicking inside
    this.dropdown.addEventListener(
      "dropdown-resized",
      this._adjustDropdown.bind(this)
    ); // Adjust when resized
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
    this.dropdownDoneButton.addEventListener(
      "click",
      this._handleDropdownDoneButtonClick.bind(this)
    );
  }

  public isEditorActive(nonCustomEditor = false): boolean {
    const activeEditor = this.stateManager.getActiveEditor();
    if (!activeEditor || (nonCustomEditor && activeEditor.isCustomEditor))
      return false;
    return true;
  }

  public isDropdownVisible(): boolean {
    return this.dropdown.style.display !== "none";
  }

  private _handleDropdownDoneButtonClick(): void {
    // Apply selections and close dropdown
    // const activeEditor = this.stateManager.getActiveEditor();
    // if (!activeEditor) {
    //   return;
    // }
    // const { row, col } = activeEditor;
    // const colKey = this.stateManager.getColumnKey(col);
    // const valueToSet = Array.from(this.selectedDropdownItems);

    // const oldValue = this.stateManager.updateCellInternal(row, col, valueToSet);
    // this.interactionManager._batchUpdateCellsAndNotify(
    //   [row],
    //   [colKey],
    //   [{ [colKey]: oldValue }]
    // );
    this.deactivateEditor(true);
    this.domManager.focusContainer();
  }

  public activateEditor(
    rowIndex: number,
    colIndex: number,
    initialChar?: string
  ): void {
    const { customDatePicker, verbose, font, onEditorOpen } = this.options;

    const colKey = this.stateManager.getColumnKey(colIndex);
    const rowData = this.stateManager.getRowData(rowIndex);
    if (!rowData) {
      log(
        "warn",
        verbose,
        `Cannot activate editor: Cell ${rowIndex},${colIndex} row data not found.`
      );
      return;
    }

    if (this.isEditorActive()) {
      this.deactivateEditor(true); // Deactivate previous editor first
    }
    this.hideDropdown(); // Ensure dropdown is hidden

    const bounds = this.renderer.getCellBounds(rowIndex, colIndex);
    if (!bounds) {
      log(
        "warn",
        verbose,
        `Cannot activate editor: Cell ${rowIndex},${colIndex} bounds not found (likely not visible).`
      );
      return;
    }

    // check if the selected cell bound need to be scrolled into view
    const { scrollLeft, scrollTop } =
      this.interactionManager.bringBoundsIntoView(bounds);

    // If the cell is loading, prevent editing
    if (rowData?.[`${LOADING_FIELD_PREFIX}${colKey}`]) {
      log(
        "log",
        verbose,
        `Edit prevented: Cell ${rowIndex},${colIndex} is loading.`
      );
      return;
    }
    // Should already be checked by event handler, but double-check
    if (this.stateManager.isCellDisabled(rowIndex, colIndex)) {
      log(
        "log",
        verbose,
        `Edit prevented: Cell ${rowIndex},${colIndex} is disabled.`
      );
      return;
    }

    const schema = this.stateManager.getSchemaForColumn(colIndex);
    if (schema?.readonly) {
      log(
        "log",
        verbose,
        `Edit prevented: Cell ${rowIndex},${colIndex} is readonly.`
      );
      return;
    }

    // clear any temporary errors for this cell
    this.renderer.clearTemporaryErrors([{ row: rowIndex, col: colIndex }]);

    const cellValue = rowData?.[colKey];
    const isCustomEditor =
      schema?.type === "date" && customDatePicker && onEditorOpen
        ? true
        : false;
    this.stateManager.setActiveEditor({
      row: rowIndex,
      col: colIndex,
      type: schema?.type,
      originalValue: cellValue,
      isCustomEditor,
    });

    const { x, y, width: editorWidth, height: editorHeight } = bounds;
    // because the canvas is translated, we need to subtract the scroll position
    const editorX = x - scrollLeft;
    const editorY = y - scrollTop;

    if (isCustomEditor) {
      try {
        onEditorOpen?.({
          rowIndex,
          colKey,
          rowData,
          bounds: {
            x: editorX,
            y: editorY,
            width: editorWidth,
            height: editorHeight,
          },
        });
      } catch (error) {
        log("error", verbose, `Error calling onEditorOpen: ${error}`);
      }
    } else if (schema?.type === "select" || schema?.type === "boolean") {
      this._showDropdown(
        rowIndex,
        colKey,
        schema,
        editorX,
        editorY,
        editorWidth,
        editorHeight
      );
      return;
    } else {
      // Determine if we should use textarea (multiline) or input
      const isMultiline = schema?.type === "text" && schema?.multiline === true;
      const editorElement = isMultiline
        ? this.editorTextarea
        : this.editorInput;

      // Configure and show the editor
      editorElement.style.display = "block";
      editorElement.style.left = `${editorX}px`;
      editorElement.style.top = `${editorY}px`;
      editorElement.style.width = `${editorWidth}px`;

      // For textarea, might want to show more rows
      if (isMultiline) {
        // Set a taller height for the textarea, constrained by available space
        const availableHeight = Math.min(
          window.innerHeight - editorY - 20, // 20px buffer
          Math.max(editorHeight * 2, 100) // At least 100px or 2x row height
        );
        this.editorTextarea.style.height = `${availableHeight}px`;
        this.editorTextarea.placeholder = schema?.placeholder || "";
      } else {
        // Regular input configuration
        this.editorInput.style.height = `${editorHeight}px`;

        // Set input type based on schema
        if (schema?.type === "number") {
          this.editorInput.type = "number";
          this.editorInput.step = schema.decimal === false ? "1" : "any";
          this.editorInput.placeholder = schema?.placeholder || "";
        } else if (schema?.type === "email") {
          this.editorInput.type = "email";
        } else if (schema?.type === "date") {
          this.editorInput.type = "date";
        } else {
          this.editorInput.type = "text";
          this.editorInput.placeholder = schema?.placeholder || "";
        }
      }

      // Format and set the value
      const formattedValue = formatValueForInput(cellValue, schema?.type);

      if (isMultiline) {
        this.editorTextarea.value = formattedValue;
        this.editorTextarea.focus();

        // Handle initial character or select all
        if (initialChar && schema?.type === "text") {
          this.editorTextarea.value = initialChar;
          // Position cursor at end
          this.editorTextarea.selectionStart =
            this.editorTextarea.selectionEnd = initialChar.length;
        } else {
          this.editorTextarea.select();
        }
      } else {
        this.editorInput.value = formattedValue;
        this.editorInput.focus();

        if (
          initialChar &&
          (["text", "email"].includes(schema?.type as string) ||
            (schema?.type === "number" && initialChar.match(/^\d*\.?\d*$/)))
        ) {
          this.editorInput.value = initialChar;
        } else if (schema?.type === "date") {
          this.editorInput.showPicker();
        } else {
          this.editorInput.select();
        }
      }
    }

    // Redraw to hide the cell content under the editor
    this.renderer.draw();
  }

  public deactivateEditor(
    saveChanges = true,
    activateCell = false,
    includeCustomEditor = false
  ): void {
    const activeEditor = this.stateManager.getActiveEditor();
    if (!activeEditor || (activeEditor.isCustomEditor && !includeCustomEditor))
      return;

    this.stateManager.newAsyncJobId(); // reset the current async job

    const { row, col, type, originalValue } = activeEditor;
    let valueChanged = false;
    let redrawRequired = false;

    if (type === "select" || type === "boolean") {
      // For dropdowns, the value is updated on click, just need to check if it changed
      const isMultiSelect = this.domManager.isDropdownMultiSelect();

      if (this.isDropdownVisible()) {
        // For multi-select, ensure the selected values are applied on deactivate
        if (isMultiSelect && saveChanges) {
          const valueToSet = Array.from(this.selectedDropdownItems);
          // Check if array values are different
          let different = false;
          if (Array.isArray(originalValue)) {
            different =
              JSON.stringify(valueToSet.sort()) !==
              JSON.stringify([...originalValue].sort());
          } else {
            different = true; // Different types, so they're different
          }

          if (different) {
            this.stateManager.updateCellInternal(row, col, valueToSet);
            valueChanged = true;
          }
        }

        this.hideDropdown(); // Ensure dropdown is hidden even if no selection made
        redrawRequired = true; // Hiding dropdown requires redraw
      }

      // For single-select, check if the value changed (already handled by click in multi-select)
      if (!isMultiSelect && !valueChanged) {
        const currentValue = this.stateManager.getCellData(row, col);
        valueChanged = currentValue !== originalValue;
      }
    } else {
      // For text input editor and textarea
      const isTextareaActive = this.editorTextarea.style.display !== "none";
      const isInputActive = this.editorInput.style.display !== "none";

      if (isTextareaActive || isInputActive) {
        if (saveChanges) {
          const newValueRaw = isTextareaActive
            ? this.editorTextarea.value
            : this.editorInput.value;

          const schemaCol = this.stateManager.getSchemaForColumn(col);
          const colKey = this.stateManager.getColumnKey(col);
          const newValue = parseValueFromInput(newValueRaw, schemaCol?.type);
          const validationResult = validateInput(
            newValue,
            schemaCol,
            colKey,
            this.stateManager.cachedDropdownOptionsByColumn.get(colKey),
            this.options.verbose
          );
          if ("error" in validationResult) {
            log("log", this.options.verbose, validationResult.error);
            // Potentially show an error message to the user here
            if (validationResult.errorType === "required") {
              this.stateManager.updateCell(
                row,
                `${ERROR_FIELD_PREFIX}${colKey}`,
                validationResult.error
              );
            } else {
              this.renderer.setTemporaryErrors([
                { row, col, error: validationResult.error },
              ]);
            }
            redrawRequired = true;
          } else {
            this.stateManager.removeCellValue(
              row,
              `${ERROR_FIELD_PREFIX}${colKey}`
            );
            if (newValue !== originalValue) {
              this.stateManager.updateCellInternal(row, col, newValue); // Update data directly
              valueChanged = true;
              // Update disabled states for the row after the change
              this.interactionManager._batchUpdateCellsAndNotify(
                [row],
                [colKey],
                [{ [colKey]: originalValue }]
              );
            }
          }
        }

        // Hide and reset the active editor
        if (isTextareaActive) {
          this.editorTextarea.style.display = "none";
          this.editorTextarea.value = "";
        } else {
          this.editorInput.style.display = "none";
          this.editorInput.value = "";
        }

        redrawRequired = true; // Hiding editor requires redraw
      }
    }

    this.stateManager.setActiveEditor(null); // Clear active editor state
    if (activateCell) {
      this.stateManager.setActiveCell({
        row,
        col,
      });
      redrawRequired = true;
    }
    // If the value changed or editor/dropdown was hidden, redraw the sheet
    if (valueChanged || redrawRequired) {
      this.renderer.draw();
    }
  }

  public hasEditorSelection(): boolean {
    return this.highlightedDropdownIndex >= 0;
  }

  private _handleEditorKeyDown(event: KeyboardEvent): void {
    if (!this.isEditorActive()) return;

    // Determine if we're dealing with textarea or input
    const isTextarea = event.target === this.editorTextarea;
    let redrawNeeded = false;
    // For textarea, only handle special keys, allow normal typing otherwise
    if (isTextarea) {
      // For Tab key in a textarea, we want to handle it ourselves
      if (event.key === "Tab") {
        // Prevent the default tab behavior (focus change)
        event.preventDefault();

        // If not shift, add a tab character to the textarea
        if (this.options.allowTabInTextarea) {
          const start = this.editorTextarea.selectionStart;
          const end = this.editorTextarea.selectionEnd;
          this.editorTextarea.value =
            this.editorTextarea.value.substring(0, start) +
            "\t" +
            this.editorTextarea.value.substring(end);

          // Move cursor after inserted tab
          this.editorTextarea.selectionStart =
            this.editorTextarea.selectionEnd = start + 1;
          return;
        } else {
          this.deactivateEditor(true);
          redrawNeeded = this.interactionManager.moveActiveCell(
            0,
            event.shiftKey ? -1 : 1
          ); // Move left/right
          // clear selections and selection range after moving
          if (redrawNeeded) {
            this.interactionManager.clearSelections();
            this.stateManager.clearSelectionRange();
          }
        }
      }

      // For Escape, just close the editor without saving
      if (event.key === "Escape") {
        this.deactivateEditor(false, true);
        this.domManager.focusContainer();
        event.preventDefault();
        return;
      }

      // For textarea, don't handle Enter (allow multiline) or other keys
      // unless combined with Ctrl or Command
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      // Handle Ctrl/Cmd + Enter to save and move to next row
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        this.deactivateEditor(true);
        const redrawNeeded = this.interactionManager.moveActiveCell(1, 0);
        if (redrawNeeded) {
          this.interactionManager.clearSelections();
          this.stateManager.clearSelectionRange();
          this.renderer.draw();
        }
        event.preventDefault();
        return;
      }
    }

    // Regular input handling (same as before)
    switch (event.key) {
      case "Enter":
        // For regular input, process Enter normally
        if (!isTextarea) {
          this.deactivateEditor(true);
          redrawNeeded = this.interactionManager.moveActiveCell(1, 0); // Move down
          // clear selections and selection range after moving
          if (redrawNeeded) {
            this.interactionManager.clearSelections();
            this.stateManager.clearSelectionRange();
          }
          event.preventDefault();
        }
        break;
      case "Escape":
        this.deactivateEditor(false, true); // Discard changes, activate cell
        this.domManager.focusContainer();
        event.preventDefault();
        return; // redraw already handled in deactivateEditor
      case "Tab":
        // For regular input, process Tab normally
        if (!isTextarea) {
          this.deactivateEditor(true);
          redrawNeeded = this.interactionManager.moveActiveCell(
            0,
            event.shiftKey ? -1 : 1
          ); // Move left/right
          // clear selections and selection range after moving
          if (redrawNeeded) {
            this.interactionManager.clearSelections();
            this.stateManager.clearSelectionRange();
          }
          event.preventDefault();
        }
        break;
    }
    if (redrawNeeded) {
      this.renderer.draw();
    }
  }

  private _populateDropdown(clear = false): void {
    if (clear) {
      this.dropdownList.innerHTML = "";
    }

    const isMultiSelect = this.domManager.isDropdownMultiSelect();

    this.dropdownItems.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = `spreadsheet-dropdown-item${
        item.id === null ? " spreadsheet-dropdown-item-blank" : ""
      }`;

      // For multi-select, add checkboxes
      if (isMultiSelect) {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.padding = "2px 4px";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.style.marginRight = "4px";
        checkbox.checked = this.selectedDropdownItems.has(item.id);
        // checkbox.addEventListener("click", (e) => {
        //   e.stopPropagation(); // Prevent triggering the li click event
        // });

        const label = document.createElement("span");
        label.textContent = item.name;
        label.title = item.name;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        li.appendChild(wrapper);
      } else {
        // Single-select (original behavior)
        li.textContent = item.name;
        li.title = item.name;
      }

      li.dataset.index = String(index);
      // Store the actual ID value (could be boolean, number, string, null)
      li.dataset.value = String(
        item.id === null || item.id === undefined ? "" : item.id
      );
      li.style.maxWidth = "200px";
      this.dropdownList.appendChild(li);
    });
  }

  private _adjustDropdown() {
    // Use requestAnimationFrame to measure after display:block takes effect
    requestAnimationFrame(() => {
      const dropdownBounds = this.dropdown.getBoundingClientRect();

      const rightX = +(this.dropdown.getAttribute("data-right-x") || 0);
      const absoluteY = +(this.dropdown.getAttribute("data-absolute-y") || 0);
      const boundsHeight = +(
        this.dropdown.getAttribute("data-bounds-height") || 0
      );

      // align the dropdown to the right of its own bounds if it extends beyond the window
      if (
        dropdownBounds.x + dropdownBounds.width >
        window.innerWidth - this.DEFAULT_SAFE_MARGIN
      ) {
        this.dropdown.style.left = `${rightX - dropdownBounds.width}px`;
      }

      const maxHeightToCheck =
        Math.max(window.innerHeight, document.body.scrollHeight) -
        this.DEFAULT_SAFE_MARGIN;
      // move the dropdown up if it extends beyond the bottom of the window
      if (dropdownBounds.y + dropdownBounds.height > maxHeightToCheck) {
        this.dropdown.style.top = `${
          absoluteY - boundsHeight - dropdownBounds.height
        }px`;
      }

      // Show/hide the Done button based on multi-select mode
      const isMultiSelect = this.domManager.isDropdownMultiSelect();
      this.dropdownDoneButton.style.display = isMultiSelect
        ? "inline-block"
        : "none";
    });
  }

  // --- Dropdown Methods ---
  private async _showDropdown(
    rowIndex: number,
    colKey: string,
    schemaCol: ColumnSchema | undefined,
    boundsX: number,
    boundsY: number,
    boundsWidth: number,
    boundsHeight: number
  ): Promise<void> {
    const { blankDropdownItemLabel, onLazySearch, verbose } = this.options;
    this.dropdownItems = [];

    // Hide the loader initially
    this.domManager.toggleDropdownLoader(false);

    // Determine if this is a multi-select dropdown
    const isMultiSelect = schemaCol?.multiple === true;
    this.domManager.setDropdownMultiSelect(isMultiSelect);

    // Initialize selected items from current cell value
    this.selectedDropdownItems.clear();
    const colIndex = this.stateManager.getColumns().indexOf(colKey);
    const currentValue = this.stateManager.getCellData(rowIndex, colIndex);

    if (isMultiSelect && Array.isArray(currentValue)) {
      // Add all selected values to the Set
      currentValue.forEach((value) => {
        if (value !== null && value !== undefined) {
          this.selectedDropdownItems.add(value);
        }
      });
    } else if (currentValue !== null && currentValue !== undefined) {
      // Single-select case (for backward compatibility)
      this.selectedDropdownItems.add(currentValue);
    }

    const defaultValues = schemaCol?.nullable
      ? [{ id: null, name: blankDropdownItemLabel }]
      : [];
    let lazySearch = false;
    // Populate dropdown items based on type
    if (schemaCol?.type === "boolean") {
      this.dropdownItems = [
        { id: true, name: "True" },
        { id: false, name: "False" },
        ...defaultValues, // Option for clearing the value if nullable
      ];
    } else if (
      schemaCol?.type === "select" &&
      (schemaCol.values || schemaCol.filterValues)
    ) {
      let valuesToAdd = schemaCol.values || [];
      {
        const filterValues = schemaCol.filterValues?.(
          this.stateManager.getRowData(rowIndex) || {},
          rowIndex
        );
        if (filterValues && filterValues instanceof Promise) {
          const jobId = this.stateManager.getActiveEditor()?.asyncJobId;
          this.stateManager.updateCell(
            rowIndex,
            `${LOADING_FIELD_PREFIX}${colKey}`,
            true
          );
          this.renderer.draw();
          const filterValuesResult = await filterValues;

          this.stateManager.removeCellValue(
            rowIndex,
            `${LOADING_FIELD_PREFIX}${colKey}`
          );
          // async operation is done, verify if we need the result
          if (jobId !== this.stateManager.currentAsyncJobId) {
            log("log", verbose, `Async operation aborted: ${colKey}`);
            // redraw to hide the loader
            this.renderer.draw();
            return;
          }

          if (filterValuesResult?.length) {
            valuesToAdd = filterValuesResult || [];
            this.stateManager.addCachedDropdownOptionForColumn(
              colKey,
              valuesToAdd
            );
          }
        } else if (filterValues) {
          valuesToAdd = filterValues;
          this.stateManager.addCachedDropdownOptionForColumn(
            colKey,
            valuesToAdd
          );
        }
      }
      this.dropdownItems = [...defaultValues, ...valuesToAdd];
    } else if (
      schemaCol?.type === "select" &&
      schemaCol.lazySearch &&
      onLazySearch
    ) {
      // For lazy search, start with just default values (if nullable)
      this.dropdownItems = [...defaultValues];
      lazySearch = true;
      // If there's an initial search term we want to trigger
      this.domManager.toggleDropdownLoader(true); // Show loading indicator
      // Immediately trigger lazy search with empty string to get initial results
      try {
        await this._handleLazySearch("");
      } catch (error) {
        log("error", verbose, `Error initializing lazy search: ${error}`);
        this.domManager.toggleDropdownLoader(false);
      }
    } else {
      log(
        "warn",
        verbose,
        `Dropdown requested for non-dropdown type: ${schemaCol?.type}`
      );
      return;
    }

    if (this.dropdownItems.length) {
      this._populateDropdown(true);
    }

    // Display the Done button based on the multiSelect setting
    this.dropdownFooter.style.display = isMultiSelect ? "block" : "none";

    // convert bounds into absolute position
    const offsetLeft = this.container.offsetLeft;
    const offsetTop = this.container.offsetTop;

    const absoluteX = boundsX + offsetLeft;
    const absoluteY = boundsY + offsetTop + boundsHeight;
    const rightX = absoluteX + boundsWidth;

    // Position and display the dropdown
    this.dropdown.style.display = "flex"; // Use flex display
    this.dropdown.style.left = `${absoluteX}px`;
    this.dropdown.style.top = `${absoluteY}px`; // Position below cell initially
    this.dropdown.style.minWidth = `${boundsWidth}px`;
    this.dropdown.style.minHeight = "200px"; // Minimum height
    this.dropdown.style.maxHeight = "400px"; // Maximum height
    this.dropdown.style.height = "300px"; // Default height
    this.dropdown.style.width = `${Math.max(boundsWidth, 200)}px`; // Min width of 200px
    this.dropdown.style.resize = "both"; // Allow resizing
    this.dropdown.style.overflow = "hidden"; // Hide overflow for the container
    this.dropdown.setAttribute("data-right-x", `${rightX}`);
    this.dropdown.setAttribute("data-absolute-y", `${absoluteY}`);
    this.dropdown.setAttribute("data-bounds-height", `${boundsHeight}`);

    this.dropdownSearchInput.placeholder =
      schemaCol?.placeholder || "Search...";

    this._adjustDropdown();

    // Reset search and focus
    this.dropdownSearchInput.value = "";
    if (!lazySearch) this._filterDropdown("");
    this.dropdownSearchInput.focus();
    this.highlightedDropdownIndex = -1;
    this._updateDropdownHighlight(
      Array.from(
        this.dropdownList.querySelectorAll("li:not(.hidden)")
      ) as HTMLLIElement[]
    );
    this.renderer.draw();
  }

  public hideDropdown(): void {
    if (this.dropdown.style.display !== "none") {
      this.dropdown.style.display = "none";
      this.highlightedDropdownIndex = -1;
    }
    // hide the loader
    this.domManager.toggleDropdownLoader(false);
  }

  private _handleDropdownSearch(): void {
    const searchTerm = this.dropdownSearchInput.value.toLowerCase();

    const activeEditor = this.stateManager.getActiveEditor();
    if (!activeEditor) return;
    const schemaCol = this.stateManager.getSchemaForColumn(activeEditor.col);

    if (schemaCol?.lazySearch && this.options.onLazySearch) {
      // Show loading indicator
      this.domManager.toggleDropdownLoader(true);
      // Trigger debounced search
      this.debouncedLazySearch(searchTerm);
      return;
    }

    this._filterDropdown(searchTerm);
    const items = Array.from(
      this.dropdownList.querySelectorAll("li:not(.hidden)")
    ) as HTMLLIElement[];
    // Reset highlight to the first visible item or -1 if none
    this.highlightedDropdownIndex = items.length > 0 ? 0 : -1;
    this._updateDropdownHighlight(items);
  }

  private _filterDropdown(searchTerm: string): void {
    const items = this.dropdownList.querySelectorAll(
      "li"
    ) as NodeListOf<HTMLLIElement>;
    items.forEach((item) => {
      const isVisible = searchTerm
        ? (item.textContent?.toLowerCase() || "").includes(searchTerm)
        : true;
      item.classList.toggle("hidden", !isVisible);
      item.style.display = isVisible ? "block" : "none"; // Control visibility
    });
  }

  private async _handleLazySearch(searchTerm: string): Promise<void> {
    const lazySearch = this.options.onLazySearch;
    if (!lazySearch) return;

    const activeEditor = this.stateManager.getActiveEditor();
    if (!activeEditor) {
      this.domManager.toggleDropdownLoader(false);
      return;
    }

    const { row, col } = activeEditor;
    const rowData = this.stateManager.getRowData(row);
    if (!rowData) {
      this.domManager.toggleDropdownLoader(false);
      return;
    }

    const colKey = this.stateManager.getColumnKey(col);
    const schemaCol = this.stateManager.getSchemaForColumn(col);
    const defaultValues = schemaCol?.nullable
      ? [{ id: null, name: this.options.blankDropdownItemLabel }]
      : [];

    try {
      // Show the loading indicator as an overlay on the list
      this.domManager.toggleDropdownLoader(true);

      const jobId = this.stateManager.getActiveEditor()?.asyncJobId;
      const items = await lazySearch({
        searchTerm,
        rowIndex: row,
        colKey,
        rowData,
      });
      // Check if we're still in the same async job
      if (jobId !== this.stateManager.currentAsyncJobId) {
        log("log", this.options.verbose, `Async operation aborted: ${colKey}`);
        this.domManager.toggleDropdownLoader(false);
        return;
      }

      const latestActiveEditor = this.stateManager.getActiveEditor();
      // Make sure we're still editing the same cell after the async operation
      if (
        !latestActiveEditor ||
        latestActiveEditor.row !== row ||
        latestActiveEditor.col !== col
      ) {
        this.domManager.toggleDropdownLoader(false);
        return;
      }

      this.dropdownItems = [...defaultValues, ...(items || [])];

      // Rebuild dropdown list
      this._populateDropdown(true);

      // Update highlight
      const visibleItems = Array.from(
        this.dropdownList.querySelectorAll("li:not(.hidden)")
      ) as HTMLLIElement[];
      this.highlightedDropdownIndex = visibleItems.length > 0 ? 0 : -1;
      this._updateDropdownHighlight(visibleItems);
    } catch (error) {
      log(
        "error",
        this.options.verbose,
        `Error calling onLazySearch: ${error}`
      );
    } finally {
      // Always hide loading indicator when done
      this.domManager.toggleDropdownLoader(false);
    }
  }

  private _handleDropdownKeyDown(event: KeyboardEvent): void {
    // is dropdown open?
    if (!this.isDropdownVisible()) return;
    const visibleItems = Array.from(
      this.dropdownList.querySelectorAll("li:not(.hidden)")
    ) as HTMLLIElement[];

    if (!visibleItems.length && event.key !== "Escape") return;

    let currentHighlight = this.highlightedDropdownIndex;
    const isMultiSelect = this.domManager.isDropdownMultiSelect();

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
      case " ": // Space key
        // In multi-select mode, toggle the highlighted item's selection state
        if (
          isMultiSelect &&
          currentHighlight >= 0 &&
          currentHighlight < visibleItems.length
        ) {
          event.preventDefault();
          const item = visibleItems[currentHighlight];
          const itemIndex = parseInt(item.dataset.index || "-1", 10);

          if (itemIndex >= 0 && itemIndex < this.dropdownItems.length) {
            const selectedData = this.dropdownItems[itemIndex];
            const itemValue = selectedData.id;

            // Toggle selection
            if (this.selectedDropdownItems.has(itemValue)) {
              this.selectedDropdownItems.delete(itemValue);
            } else {
              this.selectedDropdownItems.add(itemValue);
            }

            // Update checkbox state
            const checkbox = item.querySelector(
              'input[type="checkbox"]'
            ) as HTMLInputElement;
            if (checkbox) {
              checkbox.checked = this.selectedDropdownItems.has(itemValue);
            }

            // Update the cell value immediately
            const activeEditor = this.stateManager.getActiveEditor();
            if (activeEditor) {
              const { row, col } = activeEditor;
              const colKey = this.stateManager.getColumnKey(col);
              const valueToSet = Array.from(this.selectedDropdownItems);

              const oldValue = this.stateManager.updateCellInternal(
                row,
                col,
                valueToSet
              );
              this.interactionManager._batchUpdateCellsAndNotify(
                [row],
                [colKey],
                [{ [colKey]: oldValue }]
              );
            }
            return;
          }
        }
        break;
      case "Enter":
        event.preventDefault();
        let simulateClickIndex = -1;
        if (currentHighlight >= 0 && currentHighlight < visibleItems.length) {
          simulateClickIndex = currentHighlight;
        } else if (visibleItems.length === 1) {
          simulateClickIndex = 0;
        }
        if (simulateClickIndex >= 0) {
          visibleItems[simulateClickIndex].click(); // Simulate click on highlighted item
        }
        return; // Handled by click handler
      case "Escape":
        event.preventDefault();
        this.deactivateEditor(false, true); // Close dropdown, discard changes, activate cell
        this.domManager.focusContainer(); // Return focus to the main grid container
        return;
      case "Tab":
        // Prevent tabbing out of dropdown, maybe cycle? For now, just prevent.
        event.preventDefault();
        // check if any text in entered in the editor
        if (
          !`${this.dropdownSearchInput.value}`.trim() &&
          currentHighlight < 0
        ) {
          this.deactivateEditor(false);
          return;
        }
        break;
      default:
        return; // Let other keys (like letters) be handled by the search input
    }

    this.highlightedDropdownIndex = currentHighlight;
    this._updateDropdownHighlight(visibleItems);
  }

  private _updateDropdownHighlight(visibleItems: HTMLLIElement[]): void {
    visibleItems.forEach((item, index) => {
      const isHighlighted = index === this.highlightedDropdownIndex;
      item.classList.toggle("highlighted", isHighlighted);
      // Basic highlight style, replace with CSS classes ideally
      item.style.backgroundColor = isHighlighted ? "#dbeafe" : "white"; // fallback when css did not load
      if (isHighlighted) {
        // Ensure highlighted item is visible in the scrollable list
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private _handleDropdownItemClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const isMultiSelect = this.domManager.isDropdownMultiSelect();

    // Find the actual li element (might be clicking on checkbox, span, or div inside the li)
    let li: HTMLLIElement | null = null;
    let node: HTMLElement | null = target;

    while (node && node.tagName !== "LI") {
      node = node.parentElement;
    }

    li = node as HTMLLIElement;

    if (!li || !li.classList.contains("spreadsheet-dropdown-item")) {
      return;
    }

    const activeEditor = this.stateManager.getActiveEditor();
    if (!activeEditor) return;

    const itemIndex = parseInt(li.dataset.index || "-1", 10);
    if (itemIndex < 0 || itemIndex >= this.dropdownItems.length) return;

    const selectedData = this.dropdownItems[itemIndex];
    const { row, col } = activeEditor;
    const colKey = this.stateManager.getColumnKey(col);
    this.stateManager.addCachedDropdownOptionForColumn(colKey, [selectedData]);

    let valueToSet: any;

    if (isMultiSelect) {
      // For multi-select, toggle the selected state
      const itemValue = selectedData.id;

      if (this.selectedDropdownItems.has(itemValue)) {
        this.selectedDropdownItems.delete(itemValue);
      } else {
        this.selectedDropdownItems.add(itemValue);
      }

      // Update UI to show selection state
      const checkbox = li.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = this.selectedDropdownItems.has(itemValue);
      }
      // don't close the dropdown, user will click "Done" button to save
      // otherwise, the changes will not be saved
      return;
    } else {
      // Single-select behavior (original)
      valueToSet = selectedData.id;

      // Handle boolean case explicitly as 'true'/'false' strings might cause issues
      if (typeof valueToSet === "string" && activeEditor.type === "boolean") {
        if (valueToSet.toLowerCase() === "true") valueToSet = true;
        else if (valueToSet.toLowerCase() === "false") valueToSet = false;
        // Keep as null/undefined if it's the blank option
      }
    }

    // Update the data in the state manager
    const oldValue = this.stateManager.updateCellInternal(row, col, valueToSet);

    this.interactionManager._batchUpdateCellsAndNotify(
      [row],
      [colKey],
      [{ [colKey]: oldValue }]
    ); // Update disabled states after change

    // delay the dropdown deactivation to stop the same keyup event from reopening the dropdown
    setTimeout(() => {
      this.deactivateEditor(false); // Deactivate editor (changes already saved)
      // Optionally move to the next cell after selection
      // this.interactionManager.moveActiveCell(1, 0);
      this.domManager.focusContainer(); // Return focus to the main grid container
    }, 200);
  }
}
