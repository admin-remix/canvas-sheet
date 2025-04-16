// src/spreadsheet.ts

import {
    SpreadsheetSchema,
    DataRow,
    SpreadsheetOptions,
    ColumnSchema
} from './types';
import { DEFAULT_OPTIONS } from './config';
import { DomManager } from './dom-manager';
import { DimensionCalculator } from './dimension-calculator';
import { Renderer } from './renderer';
import { EventManager } from './event-manager';
import { EditingManager } from './editing-manager';
import { InteractionManager } from './interaction-manager';
import { StateManager } from './state-manager';
import { log } from './utils';
export type { SpreadsheetSchema, DataRow, SpreadsheetOptions, ColumnSchema } from './types';

export class Spreadsheet {
    private container: HTMLElement;
    private options: Required<SpreadsheetOptions>;
    private stateManager: StateManager;
    private domManager: DomManager;
    private dimensionCalculator: DimensionCalculator;
    private renderer: Renderer;
    private eventManager: EventManager;
    private editingManager: EditingManager;
    private interactionManager: InteractionManager;

    constructor(containerId: string, schema: SpreadsheetSchema, data: DataRow[] = [], options: SpreadsheetOptions = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container element with ID "${containerId}" not found.`);
        }
        this.container = container;

        this.options = { ...DEFAULT_OPTIONS, ...options };

        // Instantiate managers
        this.stateManager = new StateManager(schema, data, this.options);
        this.domManager = new DomManager(this.container);
        this.dimensionCalculator = new DimensionCalculator(this.options, this.stateManager, this.domManager);
        this.renderer = new Renderer(this.domManager.getContext(), this.options, this.stateManager, this.dimensionCalculator);
        this.interactionManager = new InteractionManager(this.options, this.stateManager, this.renderer, this.dimensionCalculator, this.domManager);
        this.editingManager = new EditingManager(this.container, this.options, this.stateManager, this.domManager, this.renderer, this.interactionManager);
        this.eventManager = new EventManager(
            this.container,
            this.editingManager,
            this.interactionManager,
            this.stateManager,
            this.dimensionCalculator,
            this.renderer,
            this.options,
            this.domManager
        );

        this.stateManager.setInitialData(data);
        this.dimensionCalculator.initializeSizes(data.length);
        this.domManager.setup(this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight());
        this.dimensionCalculator.calculateDimensions(this.container.clientWidth, this.container.clientHeight);
        this.eventManager.bindEvents((event: Event) => {
            if (event.type === 'resize') {
                this.onDataUpdate();
            }
        });
        this.draw();

        log('log', this.options.verbose, "Spreadsheet initialized");
    }

    public draw(): void {
        this.stateManager.updateScroll(this.domManager.getVScrollPosition(), this.domManager.getHScrollPosition());
        this.dimensionCalculator.calculateVisibleRange(); // Recalculate visible range based on scroll
        this.renderer.draw();
    }

    private onDataUpdate(top: number = 0, left: number = 0) {
        // Need to re-initialize sizes, recalculate dimensions, and redraw
        this.dimensionCalculator.initializeSizes(this.stateManager.getData().length);
        this.domManager.updateCanvasSize(this.stateManager.getTotalContentWidth(), this.stateManager.getTotalContentHeight());
        this.dimensionCalculator.calculateDimensions(this.container.clientWidth, this.container.clientHeight);
        this.interactionManager.moveScroll(left, top, true);
        this.draw();
    }

    // --- Public API Methods (delegated to managers) ---

    public getData(): DataRow[] {
        return this.stateManager.getData();
    }

    public setData(newData: DataRow[]): void {
        this.stateManager.setData(newData);
        this.onDataUpdate();
    }

    public addRow(): number {
        const newRowIndex = this.stateManager.addRow();
        this.onDataUpdate(this.container.scrollHeight, 0);
        return newRowIndex;
    }
    public addColumn(fieldName: string, colSchema: ColumnSchema): number {
        const newColIndex = this.stateManager.addColumn(fieldName, colSchema);
        this.onDataUpdate(0, this.container.scrollWidth);
        return newColIndex;
    }

    public updateCell(rowIndex: number, colKey: string, value: any): void {
        const updated = this.stateManager.updateCell(rowIndex, colKey, value);
        if (updated) {
            this.draw();
        }
    }

    // --- Helper to expose redrawing for managers ---
    public redraw(): void {
        this.draw();
    }
} 