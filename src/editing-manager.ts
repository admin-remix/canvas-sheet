import {
    RequiredSpreadsheetOptions,
    ColumnSchema,
    DropdownItem,
} from './types';
import { StateManager } from './state-manager';
import { DomManager } from './dom-manager';
import { Renderer } from './renderer';
import { InteractionManager } from './interaction-manager';
import { formatValueForInput, parseValueFromInput, validateInput, log } from './utils';

export class EditingManager {
    private container: HTMLElement;
    private options: RequiredSpreadsheetOptions;
    private stateManager: StateManager;
    private domManager: DomManager;
    private renderer: Renderer;
    private interactionManager: InteractionManager; // Needed for moving active cell

    // DOM Elements specific to editing
    private editorInput: HTMLInputElement;
    private dropdown: HTMLDivElement;
    private dropdownSearchInput: HTMLInputElement;
    private dropdownList: HTMLUListElement;

    // Dropdown state
    private dropdownItems: DropdownItem[] = [];
    private highlightedDropdownIndex: number = -1;

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
        const dropdownElements = this.domManager.getDropdownElements();
        this.dropdown = dropdownElements.dropdown;
        this.dropdownSearchInput = dropdownElements.searchInput;
        this.dropdownList = dropdownElements.list;
    }

    public bindInternalEvents(): void {
        // Editor Input Events
        this.editorInput.addEventListener('blur', this._handleEditorBlur.bind(this));
        this.editorInput.addEventListener('keydown', this._handleEditorKeyDown.bind(this));

        // Dropdown Events
        this.dropdown.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent closing dropdown when clicking inside
        this.dropdownSearchInput.addEventListener('input', this._handleDropdownSearch.bind(this));
        this.dropdownSearchInput.addEventListener('keydown', this._handleDropdownKeyDown.bind(this));
        this.dropdownList.addEventListener('click', this._handleDropdownItemClick.bind(this));
    }

    public isEditorActive(nonCustomEditor = false): boolean {
        const activeEditor = this.stateManager.getActiveEditor();
        if (!activeEditor || (nonCustomEditor && activeEditor.isCustomEditor)) return false;
        return true;
    }

    public isDropdownVisible(): boolean {
        return this.dropdown.style.display !== 'none';
    }

    public activateEditor(rowIndex: number, colIndex: number, initialChar?: string): void {
        const { customDatePicker, verbose, font, onEditorOpen } = this.options;

        const colKey = this.stateManager.getColumnKey(colIndex);
        const rowData = this.stateManager.getRowData(rowIndex);
        if (!rowData) {
            log('warn', verbose, `Cannot activate editor: Cell ${rowIndex},${colIndex} row data not found.`);
            return;
        }
        // If the cell is loading, prevent editing
        if (rowData?.[`loading:${colKey}`]) {
            log('log', verbose, `Edit prevented: Cell ${rowIndex},${colIndex} is loading.`);
            return;
        }
        // Should already be checked by event handler, but double-check
        if (this.stateManager.isCellDisabled(rowIndex, colIndex)) {
            log('log', verbose, `Edit prevented: Cell ${rowIndex},${colIndex} is disabled.`);
            return;
        }

        if (this.isEditorActive()) {
            this.deactivateEditor(true); // Deactivate previous editor first
        }
        this.hideDropdown(); // Ensure dropdown is hidden

        const bounds = this.renderer.getCellBounds(rowIndex, colIndex);
        if (!bounds) {
            log('warn', verbose, `Cannot activate editor: Cell ${rowIndex},${colIndex} bounds not found (likely not visible).`);
            return;
        }
        // check if the selected cell bound need to be scrolled into view
        const { scrollLeft, scrollTop } = this.interactionManager.bringBoundsIntoView(bounds);

        const schema = this.stateManager.getSchemaForColumn(colIndex);
        const cellValue = rowData?.[colKey];
        const isCustomEditor = (schema?.type === 'date' && customDatePicker && onEditorOpen) ? true : false;
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
                onEditorOpen?.(rowIndex, colKey, rowData, {
                    x: editorX,
                    y: editorY,
                    width: editorWidth,
                    height: editorHeight
                });
            } catch (error) {
                log('error', verbose, `Error calling onEditorOpen: ${error}`);
            }
        } else if (schema?.type === 'select' || schema?.type === 'boolean') {
            this._showDropdown(rowIndex, schema, editorX, editorY, editorWidth, editorHeight);
            return;
        } else {
            // Configure and show the text input editor
            this.editorInput.style.display = 'block';
            this.editorInput.style.left = `${editorX}px`;
            this.editorInput.style.top = `${editorY}px`;
            this.editorInput.style.width = `${editorWidth}px`;
            this.editorInput.style.height = `${editorHeight}px`;
            this.editorInput.style.font = font;

            // Set input type based on schema
            if (schema?.type === 'number') {
                this.editorInput.type = 'number';
                this.editorInput.step = schema.decimal === false ? '1' : 'any';
            } else if (schema?.type === 'email') {
                this.editorInput.type = 'email';
            } else if (schema?.type === 'date') {
                this.editorInput.type = 'date';
            } else {
                this.editorInput.type = 'text';
            }

            this.editorInput.value = formatValueForInput(cellValue, schema?.type);
            this.editorInput.focus();
            if (initialChar && (['text', 'email'].includes(schema?.type as string) || (schema?.type === 'number' && initialChar.match(/^\d*\.?\d*$/)))) {
                this.editorInput.value = initialChar;
            } else {
                this.editorInput.select();
            }
        }

        // Redraw to hide the cell content under the editor
        this.renderer.draw();
    }

    public deactivateEditor(saveChanges = true, activateCell = false): void {
        const activeEditor = this.stateManager.getActiveEditor();
        if (!activeEditor) return;

        const { row, col, type, originalValue } = activeEditor;
        let valueChanged = false;
        let redrawRequired = false;

        if (type === 'select' || type === 'boolean') {
            // For dropdowns, the value is updated on click, just need to check if it changed
            if (this.isDropdownVisible()) {
                this.hideDropdown(); // Ensure dropdown is hidden even if no selection made
                redrawRequired = true; // Hiding dropdown requires redraw
            }
            const currentValue = this.stateManager.getCellData(row, col);
            valueChanged = currentValue !== originalValue;
        } else {
            // For text input editor
            if (this.editorInput.style.display !== 'none') {
                if (saveChanges) {
                    const newValueRaw = this.editorInput.value;
                    const schemaCol = this.stateManager.getSchemaForColumn(col);
                    const colKey = this.stateManager.getColumnKey(col);
                    const newValue = parseValueFromInput(newValueRaw, schemaCol?.type);
                    const validationResult = validateInput(newValue, schemaCol, colKey, this.options.verbose);
                    if ('error' in validationResult) {
                        log('log', this.options.verbose, validationResult.error);
                        // Potentially show an error message to the user here
                        if (validationResult.errorType === 'required') {
                            this.stateManager.updateCell(row, `error:${colKey}`, validationResult.error);
                        } else {
                            this.renderer.setTemporaryError(row, col);
                        }
                        redrawRequired = true;
                    } else {
                        this.stateManager.removeCellValue(row, `error:${colKey}`);
                        if (newValue !== originalValue) {
                            this.stateManager.updateCellInternal(row, col, newValue); // Update data directly
                            valueChanged = true;
                            // Update disabled states for the row after the change
                            this.interactionManager._batchUpdateCellsAndNotify([row], [colKey]);
                        }
                    }
                }
                this.editorInput.style.display = 'none';
                this.editorInput.value = '';
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

    private _handleEditorBlur(event: FocusEvent): void {
        // Use setTimeout to allow clicks on dropdown items before blur deactivates
        setTimeout(() => {
            // Check if the new focused element is the editor itself or part of the dropdown
            const relatedTarget = event.relatedTarget as Node | null;
            if (document.activeElement !== this.editorInput && !this.dropdown.contains(relatedTarget)) {
                this.deactivateEditor(true); // Save changes on blur
            }
        }, 0);
    }

    private _handleEditorKeyDown(event: KeyboardEvent): void {
        let redrawNeeded = false;
        switch (event.key) {
            case 'Enter':
                this.deactivateEditor(true);
                redrawNeeded = this.interactionManager.moveActiveCell(1, 0); // Move down
                // clear selections and selection range after moving
                if (redrawNeeded) {
                    this.interactionManager.clearSelections();
                    this.stateManager.clearSelectionRange();
                }
                event.preventDefault();
                break;
            case 'Escape':
                this.deactivateEditor(false, true); // Discard changes, activate cell
                this.domManager.focusContainer();
                event.preventDefault();
                return; // redraw already handled in deactivateEditor
            case 'Tab':
                this.deactivateEditor(true);
                redrawNeeded = this.interactionManager.moveActiveCell(0, event.shiftKey ? -1 : 1); // Move left/right
                // clear selections and selection range after moving
                if (redrawNeeded) {
                    this.interactionManager.clearSelections();
                    this.stateManager.clearSelectionRange();
                }
                event.preventDefault();
                break;
        }
        if (redrawNeeded) {
            this.renderer.draw();
        }
    }

    // --- Dropdown Methods ---

    private async _showDropdown(
        rowIndex: number,
        schemaCol: ColumnSchema | undefined,
        boundsX: number,
        boundsY: number,
        boundsWidth: number,
        boundsHeight: number
    ): Promise<void> {
        this.dropdownItems = [];
        this.dropdownList.innerHTML = ''; // Clear previous items
        const defaultValues = schemaCol?.nullable ? [{ id: null, name: '(Blank)' }] : [];
        // Populate dropdown items based on type
        if (schemaCol?.type === 'boolean') {
            this.dropdownItems = [
                { id: true, name: 'True' },
                { id: false, name: 'False' },
                ...defaultValues, // Option for clearing the value if nullable
            ];
        } else if (schemaCol?.type === 'select' && (schemaCol.values || schemaCol.filterValues)) {
            const filterValues = schemaCol.filterValues?.(this.stateManager.getRowData(rowIndex) || {}, rowIndex);
            if (!filterValues) {
                this.dropdownItems = [...defaultValues, ...(schemaCol.values || [])];
            } else {
                const filterValuesResult = await filterValues;
                this.dropdownItems = [...defaultValues, ...(filterValuesResult || [])];
            }
        } else {
            log('warn', this.options.verbose, `Dropdown requested for non-dropdown type: ${schemaCol?.type}`);
            return;
        }

        // Create list elements
        this.dropdownItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = `spreadsheet-dropdown-item${item.id === null ? ' spreadsheet-dropdown-item-blank' : ''}`;
            li.textContent = item.name;
            li.dataset.index = String(index);
            // Store the actual ID value (could be boolean, number, string, null)
            li.dataset.value = String(item.id === null || item.id === undefined ? '' : item.id);
            // li.style.padding = '5px 10px';
            // li.style.cursor = 'pointer';
            // li.addEventListener('mouseenter', () => li.style.backgroundColor = '#f0f0f0');
            // li.addEventListener('mouseleave', () => li.style.backgroundColor = 'white');
            this.dropdownList.appendChild(li);
        });

        // Position and display the dropdown
        this.dropdown.style.display = 'block';
        this.dropdown.style.left = `${boundsX}px`;
        this.dropdown.style.top = `${boundsY + boundsHeight}px`; // Position below cell initially
        this.dropdown.style.minWidth = `${boundsWidth}px`;
        this.dropdown.style.maxHeight = '200px'; // Limit height

        // Use requestAnimationFrame to measure after display:block takes effect
        requestAnimationFrame(() => {
            const dropdownRect = this.dropdown.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // Get dropdown dimensions
            const dropdownHeight = dropdownRect.height;
            const dropdownWidth = dropdownRect.width;

            // Check if dropdown extends beyond bottom of viewport
            if (dropdownRect.bottom > viewportHeight && boundsY >= dropdownHeight) {
                this.dropdown.style.top = `${boundsY - dropdownHeight}px`; // Position above cell
            }

            // Check if dropdown extends beyond right of viewport
            if (dropdownRect.right > viewportWidth) {
                const newLeft = viewportWidth - dropdownWidth - 5; // Add some padding
                this.dropdown.style.left = `${Math.max(0, newLeft)}px`;
            }

            // Ensure dropdown doesn't go off the left edge
            if (dropdownRect.left < 0) {
                this.dropdown.style.left = '0px';
            }

            // Calculate input height for max-height adjustment
            const inputHeight = ((this.dropdown.firstChild as HTMLElement)?.clientHeight || 0) + 15; // extra height cap for the input
            this.dropdown.style.maxHeight = `${200 + inputHeight}px`; // Limit height updated
        });

        // Reset search and focus
        this.dropdownSearchInput.value = '';
        this._filterDropdown('');
        this.dropdownSearchInput.focus();
        this.highlightedDropdownIndex = -1;
        this._updateDropdownHighlight(
            Array.from(this.dropdownList.querySelectorAll("li:not(.hidden)")) as HTMLLIElement[]
        );
        this.renderer.draw();
    }

    public hideDropdown(): void {
        if (this.dropdown.style.display !== 'none') {
            this.dropdown.style.display = 'none';
            this.highlightedDropdownIndex = -1;
        }
    }

    private _handleDropdownSearch(): void {
        const searchTerm = this.dropdownSearchInput.value.toLowerCase();
        this._filterDropdown(searchTerm);
        const items = Array.from(
            this.dropdownList.querySelectorAll("li:not(.hidden)")
        ) as HTMLLIElement[];
        // Reset highlight to the first visible item or -1 if none
        this.highlightedDropdownIndex = items.length > 0 ? 0 : -1;
        this._updateDropdownHighlight(items);
    }

    private _filterDropdown(searchTerm: string): void {
        const items = this.dropdownList.querySelectorAll("li") as NodeListOf<HTMLLIElement>;
        items.forEach(item => {
            const isVisible = searchTerm ? (item.textContent?.toLowerCase() || '').includes(searchTerm) : true;
            item.classList.toggle('hidden', !isVisible);
            item.style.display = isVisible ? 'block' : 'none'; // Control visibility
        });
    }

    private _handleDropdownKeyDown(event: KeyboardEvent): void {
        const visibleItems = Array.from(
            this.dropdownList.querySelectorAll("li:not(.hidden)")
        ) as HTMLLIElement[];

        if (!visibleItems.length && event.key !== 'Escape') return;

        let currentHighlight = this.highlightedDropdownIndex;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                currentHighlight = (currentHighlight + 1) % visibleItems.length;
                break;
            case 'ArrowUp':
                event.preventDefault();
                currentHighlight = (currentHighlight - 1 + visibleItems.length) % visibleItems.length;
                break;
            case 'Enter':
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
            case 'Escape':
                event.preventDefault();
                this.deactivateEditor(false, true); // Close dropdown, discard changes, activate cell
                this.domManager.focusContainer(); // Return focus to the main grid container
                return;
            case 'Tab':
                // Prevent tabbing out of dropdown, maybe cycle? For now, just prevent.
                event.preventDefault();
                // check if any text in entered in the editor
                if (!`${this.dropdownSearchInput.value}`.trim() && currentHighlight < 0) {
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
            item.classList.toggle('highlighted', isHighlighted);
            // Basic highlight style, replace with CSS classes ideally
            item.style.backgroundColor = isHighlighted ? '#dbeafe' : 'white';// fallback when css did not load
            if (isHighlighted) {
                // Ensure highlighted item is visible in the scrollable list
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    private _handleDropdownItemClick(event: MouseEvent): void {
        const target = event.target as HTMLLIElement;
        if (target.tagName === 'LI' && target.classList.contains('spreadsheet-dropdown-item')) {
            const activeEditor = this.stateManager.getActiveEditor();
            if (!activeEditor) return;

            const itemIndex = parseInt(target.dataset.index || '-1', 10);
            if (itemIndex < 0 || itemIndex >= this.dropdownItems.length) return;

            const selectedData = this.dropdownItems[itemIndex];
            const { row, col } = activeEditor;
            let valueToSet: any = selectedData.id;

            // Handle boolean case explicitly as 'true'/'false' strings might cause issues
            if (typeof valueToSet === 'string' && activeEditor.type === 'boolean') {
                if (valueToSet.toLowerCase() === 'true') valueToSet = true;
                else if (valueToSet.toLowerCase() === 'false') valueToSet = false;
                // Keep as null/undefined if it's the blank option
            }

            // Update the data in the state manager
            this.stateManager.updateCellInternal(row, col, valueToSet);
            this.interactionManager._batchUpdateCellsAndNotify([row], [this.stateManager.getColumnKey(col)]);// Update disabled states after change

            // delay the dropdown deactivation to stop the same keyup event from reopening the dropdown
            setTimeout(() => {
                this.deactivateEditor(false); // Deactivate editor (changes already saved)
                // Optionally move to the next cell after selection
                // this.interactionManager.moveActiveCell(1, 0);
                this.domManager.focusContainer(); // Return focus to the main grid container
            }, 200);
        }
    }
} 