# Canvas-Sheet

A lightweight, high-performance spreadsheet component built on the HTML5 Canvas API for modern web applications. Unlike other canvas-based spreadsheet libraries, Canvas-Sheet uses a **schema-based approach** that gives you strong typing, validation, and custom editors for each data type.

Demo: https://admin-remix.github.io/canvas-sheet

## Features

- **Schema-based data model** with typed columns, validation, and field-specific configuration
- **Canvas-based rendering** for superior performance with large datasets
- **Virtual scrolling** to efficiently handle thousands of rows
- **Multiple data types** including text, number, date, boolean, and select/dropdown
- **Cell editing** with type-specific editors
- **Selection and range operations** (select cells, rows, copy/paste)
- **Keyboard navigation** for efficient data entry
- **Resizable rows and columns**
- **Customizable styling** with numerous appearance options
- **Zero dependencies** - pure JavaScript implementation

## Installation

```bash
npm install canvas-sheet
```

## Basic Usage

```html
<div id="spreadsheet-container" style="width: 100%; height: 500px;"></div>
```

```javascript
import { Spreadsheet } from "canvas-sheet";
// basic input and dropdown styles
import "canvas-sheet/dist/spreadsheet.css";

// Define the schema for your spreadsheet
const schema = {
  id: { type: "number", decimal: false, label: "ID" },
  name: {
    type: "text",
    required: true,
    maxlength: 50,
    label: "Full Name",
  },
  email: {
    type: "email",
    required: true,
    label: "Email Address",
  },
  isActive: { type: "boolean", label: "Active" },
};

// Your data array
const data = [
  { id: 1, name: "John Doe", email: "john@example.com", isActive: true },
  { id: 2, name: "Jane Smith", email: "jane@example.com", isActive: false },
  { id: 3, name: "Bob Johnson", email: "bob@example.com", isActive: true },
];

// Initialize the spreadsheet
const spreadsheet = new Spreadsheet(
  "spreadsheet-container", // Container ID
  schema, // Column schema
  data, // Initial data
  {
    // Optional configuration
    headerHeight: 40,
    defaultRowHeight: 36,
    font: "14px Arial",
  }
);
```

## Advanced Examples

### Using Dropdown/Select Fields

You can dynamically control which cells are disabled based on row data

```javascript
const schema = {
  // ... other fields
  status: {
    type: "select",
    label: "Status",
    values: [
      { id: 1, name: "Active" },
      { id: 2, name: "Pending" },
      { id: 3, name: "Inactive" },
    ],
    // custom cell disabling logic
    disabled: (rowData, rowIndex) => {
      console.log("Row index", rowIndex);
      return rowData.isRestricted && rowData.locationId === 1;
    },
  },
};
```

### Dynamic Data Updates

```javascript
// Get current data
const currentData = spreadsheet.getData();

// Update the data
spreadsheet.setData(newData);

// Update a single cell
spreadsheet.updateCell(rowIndex, "fieldName", newValue);
```

### Cell Update and Selection Callbacks

You can implement custom logic when cells are updated, including adding loading states and validation:

```javascript
const spreadsheet = new Spreadsheet("spreadsheet-container", schema, data, {
  // ... other options
  onCellsUpdate: (rows: CellUpdateEvent[]) => {
    // Example: Show loading and then error state for email fields from a certain domain
    for (const row of rows) {
      if (
        row.columnKeys.includes("email") &&
        row.data.email &&
        row.data.email.endsWith("@sample.net")
      ) {
        // Set loading state on single cell
        spreadsheet.updateCell(row.rowIndex, "loading:email", true);

        // Simulate async validation
        setTimeout(() => {
          // update multiple cells at once which is more efficient than updating one by one
          spreadsheet?.updateCells([
            { rowIndex: row.rowIndex, colKey: "loading:email", value: null },
            {
              rowIndex: row.rowIndex,
              colKey: "error:email",
              value: `Account ${row.data.email} does not exist`,
            },
          ]);
        }, 2000);
      }
    }
  },
  onCellSelected: ({ rowIndex, colKey, rowData }: CellEvent) => {
    console.log("Selected", rowIndex, colKey, rowData[colKey]);
  },
  // ... other options
});
```

### Custom Date Picker Support

The native date picker is used by default. Enable the `customDatePicker` option which will trigger the `onEditorOpen` callback each time a date field is opened. When user selects a date from your custom date picker, call the `setValueFromCustomEditor` method to set the value of the cell which restores focus to the spreadsheet automatically.

```javascript
import { CellEventWithBounds, Spreadsheet } from "canvas-sheet";

let spreadsheet: Spreadsheet | null = null;
let selectedCellForEditor: CellEventWithBounds | null = null;
function openDatePicker(event: CellEventWithBounds) {
  selectedCellForEditor = { ...event };
  const selectedDate = event.rowData[event.colKey];
  const positionX = event.bounds.x;
  const positionY = event.bounds.y;
  const width = event.bounds.width;
  const height = event.bounds.height;
  console.log("open custom date picker", selectedDate, "at", {
    positionX,
    positionY,
    width,
    height,
  });
  // or show a modal with a date picker
}
// call the "setValueFromCustomEditor" method to set the value of the cell after the date is selected
function closeDatePicker(value: string) {
  spreadsheet?.setValueFromCustomEditor(
    selectedCellForEditor.rowIndex,
    selectedCellForEditor.colKey,
    value
  );
  selectedCellForEditor = null;
}

spreadsheet = new Spreadsheet("spreadsheet-container", schema, data, {
  // ... other options
  customDatePicker: true,
  onEditorOpen: (event: CellEventWithBounds) => {
    openDatePicker(event);
  },
  // ... other options
});
```

## Configuration Options

Canvas-Sheet is highly customizable with many options:

```javascript
const options = {
  // Dimensions
  defaultColumnWidth: 120,
  defaultRowHeight: 30,
  minColumnWidth: 50,
  maxColumnWidth: 500,
  minRowHeight: 25,
  maxRowHeight: 100,
  headerHeight: 36,
  rowNumberWidth: 50,

  // Styling
  font: '14px Arial',
  headerFont: 'bold 14px Arial',
  textColor: '#333',
  cellBgColor: '#ffffff',
  activeCellBgColor: '#edf3ff',
  selectedRowBgColor: '#f5f8ff',
  selectedRangeBgColor: '#e8f0ff',
  headerTextColor: '#333',
  headerBgColor: '#f5f5f5',
  gridLineColor: '#e0e0e0',

  // Additional options
  textAlign: 'left',
  padding: 8,
  verbose: false

  // Custom date picker support
  customDatePicker: false,
  // when a date field is opened
  onEditorOpen: (event: CellEventWithBounds) => void,
  // when user presses delete on a column header, does not delete the column
  // you have to call "removeColumnByIndex()" to delete the column
  onColumnDelete: (colIndex: number, schema: ColumnSchema) => void,
  // after rows are deleted
  onRowDeleted: (rows: DataRow[]) => void,
  // when a cell is selected
  onCellSelected: (event: CellEvent) => void,
  // when cells are updated
  onCellsUpdate: (rows: CellUpdateEvent[]) => void,
};
```

## Column Schema Options

Each column can have type-specific configuration:

```javascript
const schema = {
  // Text field with validation
  name: {
    type: "text",
    required: true,
    maxlength: 50,
    label: "Name",
  },

  // Number field with options
  amount: {
    type: "number",
    decimal: true, // Allow decimal values
    label: "Amount",
  },

  // Boolean field (checkbox)
  isActive: {
    type: "boolean",
    label: "Active",
    defaultValue: true,
  },

  // Date field
  createdAt: {
    type: "date",
    label: "Created Date",
    defaultValue: new Date().toISOString().split("T")[0],
  },

  // Select/dropdown field
  status: {
    type: "select",
    label: "Status",
    values: [
      { id: 1, name: "Active" },
      { id: 2, name: "Pending" },
      { id: 3, name: "Inactive" },
    ],
    disabled: (data) => {
      return data.status === 3 && !data.isActive;
    },
  },
};
```

## Events and Interaction

Canvas-Sheet handles many events automatically:

- Click to select cells
- Double-click/tab/enter to edit cells
- Click and drag or shift click to select ranges
- Keyboard navigation (arrow keys, tab, enter, escape)
- Copy/paste support
- Column/row resizing
- Press delete on a column header to delete the column (if removable is true)
- Press delete on selected rows to delete the rows

## Browser Support

Canvas-Sheet works in all modern browsers that support HTML5 Canvas.

## License

MIT
