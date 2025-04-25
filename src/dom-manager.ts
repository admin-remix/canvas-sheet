export class DomManager {
    private container: HTMLElement;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private editorInput: HTMLInputElement;
    private dropdownWrapper: HTMLDivElement;
    private dropdown: HTMLDivElement;
    private dropdownSearchInput: HTMLInputElement;
    private dropdownLoader: HTMLDivElement;
    private dropdownList: HTMLUListElement;
    private systemScrollbarWidth: number = 0;
    private hScrollbar: HTMLDivElement;
    private vScrollbar: HTMLDivElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.container.style.position = "relative";
        this.container.tabIndex = -1; // Allow container to receive focus for keyboard events

        this.systemScrollbarWidth = this.getSystemScrollbarWidth() + 1;
        // Canvas setup
        this.canvas = document.createElement('canvas');

        const ctx = this.canvas.getContext('2d');
        if (!ctx) {
            throw new Error("Failed to get 2D context from canvas");
        }
        this.ctx = ctx;
        this.container.appendChild(this.canvas);

        this.hScrollbar = document.createElement('div');
        this.hScrollbar.id = "spreadsheet-hscrollbar";
        this.hScrollbar.style.position = "absolute";
        this.hScrollbar.style.bottom = "0";
        this.hScrollbar.style.left = "0";
        this.hScrollbar.style.width = `calc(100% - ${this.systemScrollbarWidth}px)`;
        this.hScrollbar.style.overflow = "auto";
        this.container.appendChild(this.hScrollbar);

        this.vScrollbar = document.createElement('div');
        this.vScrollbar.id = "spreadsheet-vscrollbar";
        this.vScrollbar.style.position = "absolute";
        this.vScrollbar.style.right = "0";
        this.vScrollbar.style.top = "0";
        this.vScrollbar.style.width = `${this.systemScrollbarWidth}px`;
        this.vScrollbar.style.height = `calc(100% - ${this.systemScrollbarWidth}px)`;
        this.vScrollbar.style.overflow = "auto";
        this.container.appendChild(this.vScrollbar);


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
        this.dropdown.style.minHeight = '100px';
        this.dropdown.style.height = '200px';// default height

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

        // Create loading spinner
        this.dropdownLoader = document.createElement('div');
        this.dropdownLoader.className = "spreadsheet-dropdown-loader";
        this.dropdownLoader.style.display = 'none';
        this.dropdownLoader.style.textAlign = 'center';
        this.dropdownLoader.style.padding = '8px 0';
        this.dropdownLoader.style.borderBottom = '1px solid #eee';

        // SVG spinner
        this.dropdownLoader.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .spinner {
                        animation: spin 1.5s linear infinite;
                        transform-origin: center;
                    }
                </style>
                <circle class="spinner" cx="12" cy="12" r="10" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="40 60" />
            </svg>
        `;

        this.dropdownList = document.createElement('ul');
        this.dropdownList.className = "spreadsheet-dropdown-list";
        this.dropdownList.style.listStyle = 'none';
        this.dropdownList.style.margin = '0';
        this.dropdownList.style.padding = '0';
        this.dropdownList.style.overflowY = 'auto';

        // This element will be placed in the body for global positioning
        this.dropdownWrapper = document.createElement('div');
        this.dropdownWrapper.className = "canvas-sheet-dropdown-wrapper";

        // append to the appropriate parents
        document.body.appendChild(this.dropdownWrapper);
        this.dropdown.appendChild(searchContainer);
        this.dropdown.appendChild(this.dropdownLoader);
        this.dropdown.appendChild(this.dropdownList);
        this.dropdownWrapper.appendChild(this.dropdown);
    }
    public toggleDropdownLoader(show: boolean): void {
        if (show) {
            this.dropdownLoader.style.display = 'flex';
            this.dropdownLoader.style.justifyContent = 'center';
        } else {
            this.dropdownLoader.style.display = 'none';
        }
    }

    public checkEventBoundInDropdown(event: MouseEvent): boolean {
        return this.dropdown.contains(event.target as Node);
    }

    public getSystemScrollbarWidth(): number {
        if (this.systemScrollbarWidth) {
            return this.systemScrollbarWidth;
        }
        // Create a temporary outer div
        const outer = document.createElement('div');
        outer.style.visibility = 'hidden'; // Hide it visually
        outer.style.overflow = 'scroll'; // Force scrollbars
        document.body.appendChild(outer);
        // Create a temporary inner div
        const inner = document.createElement('div');
        outer.appendChild(inner);
        // Calculate the difference between the outer width and the inner content width
        // clientWidth excludes the scrollbar width
        const scrollbarWidth = outer.offsetWidth - outer.clientWidth;
        // Clean up by removing the temporary divs
        outer.parentNode?.removeChild(outer);
        return scrollbarWidth;
    }

    public setup(totalContentWidth: number, totalContentHeight: number): void {
        this.updateCanvasSize(totalContentWidth, totalContentHeight);
    }

    public updateCanvasSize(width: number, height: number): void {
        this.container.setAttribute('data-width', `${width}`);
        this.container.setAttribute('data-height', `${height}`);
        this.hScrollbar.innerHTML = `<div class="placeholder" style="width: ${width}px; height: 1px;"></div>`;
        this.vScrollbar.innerHTML = `<div class="placeholder" style="width: 1px; height: ${height}px;"></div>`;

        const canvasWidth = this.container.clientWidth - this.systemScrollbarWidth;
        const canvasHeight = this.container.clientHeight - this.systemScrollbarWidth;
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.canvas.style.width = `${canvasWidth}px`;
        this.canvas.style.height = `${canvasHeight}px`;
    }

    public getHScrollbar(): HTMLDivElement {
        return this.hScrollbar;
    }

    public getVScrollbar(): HTMLDivElement {
        return this.vScrollbar;
    }
    public getHScrollPosition(): number {
        return this.hScrollbar.scrollLeft;
    }
    public setHScrollPosition(position: number): number {
        this.hScrollbar.scrollLeft = position;
        return this.hScrollbar.scrollLeft;
    }

    public getVScrollPosition(): number {
        return this.vScrollbar.scrollTop;
    }
    public setVScrollPosition(position: number): number {
        this.vScrollbar.scrollTop = position;
        return this.vScrollbar.scrollTop;
    }

    public canVScrollUp(): boolean {
        return this.vScrollbar.scrollTop > 0;
    }
    public canVScrollDown(): boolean {
        return this.vScrollbar.scrollTop + this.vScrollbar.clientHeight < this.vScrollbar.scrollHeight;
    }
    public canHScrollRight(): boolean {
        return this.hScrollbar.scrollLeft + this.hScrollbar.clientWidth < this.hScrollbar.scrollWidth;
    }
    public canHScrollLeft(): boolean {
        return this.hScrollbar.scrollLeft > 0;
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
        loader: HTMLDivElement;
        list: HTMLUListElement;
    } {
        return {
            dropdown: this.dropdown,
            searchInput: this.dropdownSearchInput,
            loader: this.dropdownLoader,
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