export class DomManager {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private editorInput: HTMLInputElement;
  private editorTextarea: HTMLTextAreaElement;
  private dropdownWrapper: HTMLDivElement;
  private dropdown: HTMLDivElement;
  private dropdownSearchInput: HTMLInputElement;
  private dropdownLoader: HTMLDivElement;
  private dropdownList: HTMLUListElement;
  private systemScrollbarWidth: number = 0;
  private hScrollbar: HTMLDivElement;
  private vScrollbar: HTMLDivElement;
  private dropdownMultiSelect: boolean = false;
  private dropdownFooter: HTMLDivElement;
  private dropdownDoneButton: HTMLButtonElement;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.position = "relative";
    this.container.tabIndex = -1; // Allow container to receive focus for keyboard events

    this.systemScrollbarWidth = this.getSystemScrollbarWidth() + 1;
    // Canvas setup
    this.canvas = document.createElement("canvas");

    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context from canvas");
    }
    this.ctx = ctx;
    this.container.appendChild(this.canvas);

    this.hScrollbar = document.createElement("div");
    this.hScrollbar.id = "spreadsheet-hscrollbar";
    this.hScrollbar.style.position = "absolute";
    this.hScrollbar.style.bottom = "0";
    this.hScrollbar.style.overflow = "auto";
    this.container.appendChild(this.hScrollbar);

    this.vScrollbar = document.createElement("div");
    this.vScrollbar.id = "spreadsheet-vscrollbar";
    this.vScrollbar.style.position = "absolute";
    this.vScrollbar.style.right = "0";
    this.vScrollbar.style.width = `${this.systemScrollbarWidth}px`;
    this.vScrollbar.style.overflow = "auto";
    this.container.appendChild(this.vScrollbar);

    // Editor Input setup
    this.editorInput = document.createElement("input");
    this.editorInput.className = "spreadsheet-editor";
    this.editorInput.style.position = "absolute";
    this.editorInput.style.display = "none";
    this.editorInput.style.boxSizing = "border-box"; // Include padding/border in size
    this.container.appendChild(this.editorInput);

    // Textarea Editor setup
    this.editorTextarea = document.createElement("textarea");
    this.editorTextarea.className =
      "spreadsheet-editor spreadsheet-editor-textarea";
    this.editorTextarea.style.position = "absolute";
    this.editorTextarea.style.display = "none";
    this.editorTextarea.style.boxSizing = "border-box";
    this.editorTextarea.style.overflow = "auto";
    this.container.appendChild(this.editorTextarea);

    // Dropdown setup
    this.dropdown = document.createElement("div");
    this.dropdown.className = "spreadsheet-dropdown";
    this.dropdown.style.position = "absolute";
    this.dropdown.style.display = "none";
    this.dropdown.style.zIndex = "100"; // Ensure dropdown is on top
    this.dropdown.style.border = "1px solid #ccc";
    this.dropdown.style.backgroundColor = "white";
    this.dropdown.style.boxShadow = "0 2px 5px rgba(0,0,0,0.15)";
    this.dropdown.style.minHeight = "100px";
    this.dropdown.style.height = "200px"; // default height
    this.dropdown.style.display = "flex";
    this.dropdown.style.flexDirection = "column";

    const searchContainer = document.createElement("div");
    searchContainer.className = "spreadsheet-dropdown-search";
    searchContainer.style.padding = "5px";
    searchContainer.style.borderBottom = "1px solid #eee";
    searchContainer.style.flexShrink = "0"; // Don't shrink

    this.dropdownSearchInput = document.createElement("input");
    this.dropdownSearchInput.type = "text";
    this.dropdownSearchInput.placeholder = "Search...";
    this.dropdownSearchInput.style.width = "100%";
    this.dropdownSearchInput.style.boxSizing = "border-box";
    this.dropdownSearchInput.style.padding = "4px";

    searchContainer.appendChild(this.dropdownSearchInput);

    // Create a list wrapper that will be scrollable
    const listWrapper = document.createElement("div");
    listWrapper.className = "spreadsheet-dropdown-list-wrapper";
    listWrapper.style.flex = "1"; // Take remaining space
    listWrapper.style.overflow = "auto"; // Make this scrollable
    listWrapper.style.position = "relative"; // For proper scrolling

    // Create loading spinner that will overlay on top of list
    this.dropdownLoader = document.createElement("div");
    this.dropdownLoader.className = "spreadsheet-dropdown-loader";
    this.dropdownLoader.style.display = "flex";
    this.dropdownLoader.style.justifyContent = "center";
    this.dropdownLoader.style.alignItems = "center";
    this.dropdownLoader.style.position = "absolute";
    this.dropdownLoader.style.top = "0";
    this.dropdownLoader.style.left = "0";
    this.dropdownLoader.style.right = "0";
    this.dropdownLoader.style.bottom = "0";
    this.dropdownLoader.style.backgroundColor = "rgba(255, 255, 255, 0.85)"; // Semi-transparent background
    this.dropdownLoader.style.zIndex = "10"; // Ensure it's above the list content
    this.dropdownLoader.style.visibility = "hidden"; // Hidden by default

    // SVG spinner
    this.dropdownLoader.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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

    this.dropdownList = document.createElement("ul");
    this.dropdownList.className = "spreadsheet-dropdown-list";
    this.dropdownList.style.listStyle = "none";
    this.dropdownList.style.margin = "0";
    this.dropdownList.style.padding = "0";

    listWrapper.appendChild(this.dropdownList);
    listWrapper.appendChild(this.dropdownLoader); // Add loader as overlay to the list wrapper

    this.dropdownFooter = document.createElement("div");
    this.dropdownFooter.className = "spreadsheet-dropdown-footer";
    this.dropdownFooter.style.padding = "8px";
    this.dropdownFooter.style.textAlign = "right";
    this.dropdownFooter.style.borderTop = "1px solid #eee";
    this.dropdownFooter.style.display = "block"; // Make it visible by default
    this.dropdownFooter.style.flexShrink = "0"; // Don't shrink
    this.dropdownFooter.style.backgroundColor = "#f9f9f9"; // Light gray background

    this.dropdownDoneButton = document.createElement("button");
    this.dropdownDoneButton.textContent = "Done";
    this.dropdownDoneButton.style.padding = "6px 12px";
    this.dropdownDoneButton.style.backgroundColor = "#2563eb";
    this.dropdownDoneButton.style.color = "white";
    this.dropdownDoneButton.style.border = "none";
    this.dropdownDoneButton.style.borderRadius = "4px";
    this.dropdownDoneButton.style.cursor = "pointer";
    this.dropdownDoneButton.style.fontWeight = "bold";
    this.dropdownDoneButton.style.fontSize = "14px";

    // Add hover effects
    this.dropdownDoneButton.addEventListener("mouseover", () => {
      this.dropdownDoneButton.style.backgroundColor = "#1d4ed8"; // Darker blue on hover
    });
    this.dropdownDoneButton.addEventListener("mouseout", () => {
      this.dropdownDoneButton.style.backgroundColor = "#2563eb"; // Back to original color
    });

    this.dropdownFooter.appendChild(this.dropdownDoneButton);

    // This element will be placed in the body for global positioning
    this.dropdownWrapper = document.createElement("div");
    this.dropdownWrapper.className = "canvas-sheet-dropdown-wrapper";

    // append to the appropriate parents
    document.body.appendChild(this.dropdownWrapper);
    this.dropdown.appendChild(searchContainer);
    this.dropdown.appendChild(listWrapper); // List wrapper contains both list and loader
    this.dropdown.appendChild(this.dropdownFooter);
    this.dropdownWrapper.appendChild(this.dropdown);

    // Create resize observer to maintain layout when dropdown is resized
    this.resizeObserver = new ResizeObserver(() => {
      this.dropdown.dispatchEvent(new CustomEvent("dropdown-resized"));
    });
    this.resizeObserver.observe(this.dropdown);
  }

  public toggleDropdownLoader(show: boolean): void {
    this.dropdownLoader.style.visibility = show ? "visible" : "hidden";
  }

  public checkEventBoundInDropdown(event: MouseEvent): boolean {
    return this.dropdown.contains(event.target as Node);
  }

  public getSystemScrollbarWidth(): number {
    if (this.systemScrollbarWidth) {
      return this.systemScrollbarWidth;
    }
    // Create a temporary outer div
    const outer = document.createElement("div");
    outer.style.visibility = "hidden"; // Hide it visually
    outer.style.overflow = "scroll"; // Force scrollbars
    document.body.appendChild(outer);
    // Create a temporary inner div
    const inner = document.createElement("div");
    outer.appendChild(inner);
    // Calculate the difference between the outer width and the inner content width
    // clientWidth excludes the scrollbar width
    const scrollbarWidth = outer.offsetWidth - outer.clientWidth;
    // Clean up by removing the temporary divs
    outer.parentNode?.removeChild(outer);
    return scrollbarWidth;
  }

  public updateScrollbarPositions(
    headerHeight: number,
    rowNumberWidth: number
  ): void {
    // Update horizontal scrollbar position and dimensions
    this.hScrollbar.style.left = `${rowNumberWidth}px`;
    this.hScrollbar.style.width = `calc(100% - ${rowNumberWidth}px - ${this.systemScrollbarWidth}px)`;

    // Update vertical scrollbar position and dimensions
    this.vScrollbar.style.top = `${headerHeight}px`;
    this.vScrollbar.style.height = `calc(100% - ${headerHeight}px - ${this.systemScrollbarWidth}px)`;
  }

  public setup(
    totalContentWidth: number,
    totalContentHeight: number,
    headerHeight: number = 0,
    rowNumberWidth: number = 0
  ): void {
    this.updateCanvasSize(totalContentWidth, totalContentHeight);
    this.updateScrollbarPositions(headerHeight, rowNumberWidth);
  }

  public updateCanvasSize(width: number, height: number): void {
    this.container.setAttribute("data-width", `${width}`);
    this.container.setAttribute("data-height", `${height}`);
    this.hScrollbar.innerHTML = `<div class="placeholder" style="width: ${width}px; height: 1px;"></div>`;
    this.vScrollbar.innerHTML = `<div class="placeholder" style="width: 1px; height: ${height}px;"></div>`;

    const canvasWidth = this.container.clientWidth - this.systemScrollbarWidth;
    const canvasHeight =
      this.container.clientHeight - this.systemScrollbarWidth;
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
    this.canvas.style.width = `${canvasWidth}px`;
    this.canvas.style.height = `${canvasHeight}px`;
  }

  // Multi-select dropdown methods
  public isDropdownMultiSelect(): boolean {
    return this.dropdownMultiSelect;
  }

  public setDropdownMultiSelect(isMultiSelect: boolean): void {
    this.dropdownMultiSelect = isMultiSelect;
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
    return (
      this.vScrollbar.scrollTop + this.vScrollbar.clientHeight <
      this.vScrollbar.scrollHeight
    );
  }
  public canHScrollRight(): boolean {
    return (
      this.hScrollbar.scrollLeft + this.hScrollbar.clientWidth <
      this.hScrollbar.scrollWidth
    );
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

  public getEditorTextarea(): HTMLTextAreaElement {
    return this.editorTextarea;
  }

  public getDropdownElements(): {
    dropdown: HTMLDivElement;
    searchInput: HTMLInputElement;
    loader: HTMLDivElement;
    list: HTMLUListElement;
    footer: HTMLDivElement;
    doneButton: HTMLButtonElement;
  } {
    return {
      dropdown: this.dropdown,
      searchInput: this.dropdownSearchInput,
      loader: this.dropdownLoader,
      list: this.dropdownList,
      footer: this.dropdownFooter,
      doneButton: this.dropdownDoneButton,
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
