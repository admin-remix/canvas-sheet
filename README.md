# Canvas-Sheet

A lightweight, high-performance spreadsheet component built on the HTML5 Canvas API for modern web applications. Unlike other canvas-based spreadsheet libraries, Canvas-Sheet uses a **schema-based approach** that gives you strong typing, validation, and custom editors for each data type.

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
import { Spreadsheet } from 'canvas-sheet';

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
  isActive: { type: "boolean", label: "Active" }
};

// Your data array
const data = [
  { id: 1, name: "John Doe", email: "john@example.com", isActive: true },
  { id: 2, name: "Jane Smith", email: "jane@example.com", isActive: false },
  { id: 3, name: "Bob Johnson", email: "bob@example.com", isActive: true }
];

// Initialize the spreadsheet
const spreadsheet = new Spreadsheet(
  "spreadsheet-container", // Container ID
  schema,                  // Column schema
  data,                    // Initial data
  {                        // Optional configuration
    headerHeight: 40,
    defaultRowHeight: 36,
    font: "14px Arial"
  }
);
```

## Advanced Examples

### Using Dropdown/Select Fields

```javascript
const schema = {
  // ... other fields
  status: {
    type: "select",
    label: "Status",
    values: [
      { id: 1, name: "Active" },
      { id: 2, name: "Pending" },
      { id: 3, name: "Inactive" }
    ]
  }
};
```

### Dynamic Data Updates

```javascript
// Get current data
const currentData = spreadsheet.getData();

// Update the data
spreadsheet.setData(newData);

// Update a single cell
spreadsheet.updateCell(rowIndex, 'fieldName', newValue);
```

### Custom Cell Disabling Logic

You can dynamically control which cells are disabled based on row data:

```javascript
// Disable the locationId cell if isRestricted is true AND locationId is 1
function customIsCellDisabled(rowIndex, colKey, rowData) {
  return colKey === "locationId" && rowData.isRestricted && rowData.locationId === 1;
}

// Then pass it in the options
const spreadsheet = new Spreadsheet(
  "spreadsheet-container",
  schema,
  data,
  {
    isCellDisabled: customIsCellDisabled
  }
);
```

### Cell Update Callbacks

You can implement custom logic when cells are updated, including adding loading states and validation:

```javascript
const spreadsheet = new Spreadsheet(
  "spreadsheet-container",
  schema,
  data,
  {
    onCellsUpdate: (rows) => {
      // Example: Show loading and then error state for email fields from a certain domain
      const row = rows[0];
      if (row.columnKeys.includes('email') && row.data.email && row.data.email.endsWith('@sample.net')) {
        // Set loading state
        spreadsheet.updateCell(row.rowIndex, 'loading:email', true);
        
        // Simulate async validation
        setTimeout(() => {
          // Remove loading state
          spreadsheet.updateCell(row.rowIndex, 'loading:email', null);
          // Set error state
          spreadsheet.updateCell(row.rowIndex, 'error:email', "Invalid email domain");
        }, 2000);
      }
    }
  }
);
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
    label: "Name"
  },
  
  // Number field with options
  amount: {
    type: "number",
    decimal: true,  // Allow decimal values
    label: "Amount"
  },
  
  // Boolean field (checkbox)
  isActive: {
    type: "boolean",
    label: "Active"
  },
  
  // Date field
  createdAt: {
    type: "date",
    label: "Created Date"
  },
  
  // Select/dropdown field
  status: {
    type: "select",
    label: "Status",
    values: [
      { id: 1, name: "Active" },
      { id: 2, name: "Pending" },
      { id: 3, name: "Inactive" }
    ]
  }
};
```

## Events and Interaction

Canvas-Sheet handles many events automatically:

- Click to select cells
- Double-click to edit cells
- Click and drag or shift click to select ranges
- Keyboard navigation (arrow keys, tab, enter, escape)
- Copy/paste support
- Column/row resizing

## Browser Support

Canvas-Sheet works in all modern browsers that support HTML5 Canvas.

## License

MIT
