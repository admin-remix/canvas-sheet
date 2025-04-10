// src/dom-manager.ts

export class DomManager {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private editorInput: HTMLInputElement;
    private dropdown: HTMLDivElement;
    private dropdownSearchInput: HTMLInputElement;
    private dropdownList: HTMLUListElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.container.style.position = "relative";
        this.container.tabIndex = -1; // Allow container to receive focus for keyboard events

        // Canvas setup
        this.canvas = document.createElement('canvas');
        const ctx = this.canvas.getContext('2d');
        if (!ctx) {
            throw new Error("Failed to get 2D context from canvas");
        }
        this.ctx = ctx;
        this.container.appendChild(this.canvas);

        // Editor Input setup
        this.editorInput = document.createElement('input');
        this.editorInput.className = "spreadsheet-editor";
        this.editorInput.style.position = 'absolute';
        this.editorInput.style.display = 'none';
        this.editorInput.style.boxSizing = 'border-box'; // Include padding/border in size
        this.container.appendChild(this.editorInput);

        // Dropdown setup
        this.dropdown = document.createElement('div');
        this.dropdown.className = "spreadsheet-dropdown";
        this.dropdown.style.position = 'absolute';
        this.dropdown.style.display = 'none';
        this.dropdown.style.zIndex = '100'; // Ensure dropdown is on top
        this.dropdown.style.border = '1px solid #ccc';
        this.dropdown.style.backgroundColor = 'white';
        this.dropdown.style.boxShadow = '0 2px 5px rgba(0,0,0,0.15)';

        const searchContainer = document.createElement('div');
        searchContainer.className = "spreadsheet-dropdown-search";
        searchContainer.style.padding = '5px';
        searchContainer.style.borderBottom = '1px solid #eee';

        this.dropdownSearchInput = document.createElement('input');
        this.dropdownSearchInput.type = 'text';
        this.dropdownSearchInput.placeholder = "Search...";
        this.dropdownSearchInput.style.width = '100%';
        this.dropdownSearchInput.style.boxSizing = 'border-box';
        this.dropdownSearchInput.style.padding = '4px';

        searchContainer.appendChild(this.dropdownSearchInput);

        this.dropdownList = document.createElement('ul');
        this.dropdownList.className = "spreadsheet-dropdown-list";
        this.dropdownList.style.listStyle = 'none';
        this.dropdownList.style.margin = '0';
        this.dropdownList.style.padding = '0';
        this.dropdownList.style.maxHeight = '200px';
        this.dropdownList.style.overflowY = 'auto';

        this.dropdown.appendChild(searchContainer);
        this.dropdown.appendChild(this.dropdownList);
        this.container.appendChild(this.dropdown);
    }

    public setup(totalContentWidth: number, totalContentHeight: number): void {
        this.updateCanvasSize(totalContentWidth, totalContentHeight);
    }

    public updateCanvasSize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
    }

    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public getContext(): CanvasRenderingContext2D {
        return this.ctx;
    }

    public getEditorInput(): HTMLInputElement {
        return this.editorInput;
    }

    public getDropdownElements(): {
        dropdown: HTMLDivElement;
        searchInput: HTMLInputElement;
        list: HTMLUListElement;
    } {
        return {
            dropdown: this.dropdown,
            searchInput: this.dropdownSearchInput,
            list: this.dropdownList,
        };
    }

    public focusContainer(): void {
        this.container.focus();
    }

    public setCursor(cursorType: string): void {
        this.canvas.style.cursor = cursorType;
    }

    public getCanvasBoundingClientRect(): DOMRect {
        return this.canvas.getBoundingClientRect();
    }
} 