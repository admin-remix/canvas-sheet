import {
  DataRow,
  Spreadsheet,
  SpreadsheetSchema,
  CellUpdateEvent,
  ColumnSchema,
  SelectOption,
  CellUpdateInput,
  CellEvent,
  CellEventWithSearch,
  RowNumberContextMenuEvent,
  ColumnHeaderContextMenuEvent,
  CellContextMenuEvent,
  EditorOpenedEvent,
} from "canvas-sheet";
import "@/spreadsheet.css"; // basic styles

const DOMAINS = [
  "example.com",
  "sample.net",
  "testing.org",
  "sample.com",
  "testing.net",
  "example.net",
];
const LOCATIONS = [
  { id: 1, name: "New York" },
  { id: 2, name: "London" },
  { id: 3, name: "Tokyo" },
  { id: 4, name: "Paris" },
  { id: 5, name: "Sydney" },
  { id: 6, name: "Berlin" },
  { id: 7, name: "Cairo" },
  { id: 8, name: "Rio de Janeiro" },
  { id: 9, name: "Moscow" },
  { id: 10, name: "Beijing" },
];

const DEPARTMENTS = [
  { id: 1, name: "Sales", locationId: 1 },
  { id: 2, name: "Marketing", locationId: 3 },
  { id: 3, name: "Engineering", locationId: 7 },
  { id: 4, name: "Finance", locationId: 1 },
  { id: 5, name: "Human Resources", locationId: null },
  { id: 6, name: "Legal", locationId: 9 },
  { id: 7, name: "Customer Support", locationId: 4 },
  { id: 8, name: "Research", locationId: 8 },
  { id: 9, name: "IT", locationId: 3 },
  { id: 10, name: "Management", locationId: 10 },
  { id: 11, name: "Operations" },
  { id: 12, name: "Customer Success" },
  { id: 13, name: "Data Science" },
  { id: 14, name: "Product Engineering" },
  { id: 15, name: "Product Management" },
  { id: 16, name: "Product Security" },
  { id: 17, name: "Product Compliance" },
  { id: 18, name: "Product Risk Management" },
  { id: 19, name: "Product Audit" },
  { id: 20, name: "Product Investigations" },
];
async function getAsyncData(rowData: DataRow) {
  return new Promise<SelectOption[]>((resolve) => {
    setTimeout(() => {
      if (rowData.locationId) {
        resolve(
          Array.from({ length: rowData.locationId + 1 }, (_, i) => ({
            id: i + 1,
            name: `Checkout ${i + 1}`,
          }))
        );
      } else {
        resolve([]);
      }
    }, 1000 + Math.random() * 2000);
  });
}
// --- Schema Definition ---
const schema: SpreadsheetSchema = {
  id: { type: "number", label: "ID", readonly: true, defaultValue: null },
  name: {
    type: "text",
    required: true,
    maxlength: 20,
    label: "Full Name",
    placeholder: "Enter full name",
  },
  email: {
    type: "email",
    required: true,
    // placeholder: "Enter email",
    label: "Email Address",
    placeholder: "Enter email address",
  },
  dob: {
    type: "date",
    label: "Date of Birth",
    defaultValue: new Date().toISOString().split("T")[0],
  },
  locationId: {
    type: "select",
    label: "Location",
    nullable: true,
    values: LOCATIONS,
    placeholder: "Select location",
  },
  departmentId: {
    type: "select",
    label: "Department",
    // tooltip: "Select your department",
    values: DEPARTMENTS,
    // custom cell disabling logic
    disabled: (rowData: DataRow) => {
      return !rowData.locationId;
    },
    // custom dropdown filtering logic
    filterValues: (rowData: DataRow) => {
      return [
        { id: null, name: "(Empty)" },
        ...(rowData.locationId
          ? DEPARTMENTS.filter((d) => d.locationId === rowData.locationId)
          : []),
      ] as SelectOption[];
    },
    placeholder: "Select department",
  },
  checkoutId: {
    type: "select",
    label: "Checkout",
    filterValues: getAsyncData,
    placeholder: "Select One",
  },
  isRestricted: {
    type: "boolean",
    label: "Restricted",
    nullable: true,
    defaultValue: true,
  },
  salary: { type: "number", label: "Salary" },
  notes: { type: "text", label: "Notes", multiline: true, wordWrap: true },
};

function generateRandomData(numRows: number): DataRow[] {
  const locationDepartmentMap = new Map<number, { id: number; name: string }[]>(
    LOCATIONS.map((l) => [
      l.id,
      DEPARTMENTS.filter((d) => d.locationId === l.id),
    ])
  );
  return Array.from({ length: numRows }, (_, i) => {
    const locationId =
      Math.random() < 0.5 ? null : Math.floor(Math.random() * 10) + 1;
    let departmentId: number | null = null;
    if (locationId) {
      const departments = locationDepartmentMap.get(locationId);
      if (departments?.length) {
        departmentId =
          departments.length === 1
            ? departments[0].id
            : departments[Math.floor(Math.random() * departments.length)].id;
      }
    }
    return {
      id: i + 1,
      name: `Person ${i + 1}`,
      email: `person${i + 1}@${
        DOMAINS[Math.floor(Math.random() * DOMAINS.length)]
      }`,
      dob:
        Math.random() < 0.5
          ? null
          : new Date(Math.floor(Math.random() * 10000000000))
              .toISOString()
              .split("T")[0],
      locationId,
      departmentId,
      isRestricted: Math.random() < 0.5,
      salary: Math.floor(Math.random() * 100000) + 10000,
      notes: `Notes for Person ${i + 1}`,
    };
  });
}

// --- Sample Data ---
const sampleData = !window.location.search.includes("bigdata")
  ? [
      {
        id: 1,
        name: "Alice Johnson",
        email: "alice@example.com",
        dob: "1990-05-15",
        locationId: 1,
        isRestricted: false,
        salary: 75000,
        notes: "Team Lead",
      },
      {
        id: 2,
        name: "Bob Smith",
        email: "bob@sample.net",
        dob: "1985-11-22",
        locationId: null,
        isRestricted: true,
        salary: 120000,
        notes: "Senior Developer",
      },
      {
        id: 3,
        name: "Charlie Brown",
        email: "charlie@testing.org",
        ["error:email"]: "User does not exist",
        dob: "1998-02-10",
        locationId: 2,
        isRestricted: false,
        salary: 55000,
        notes: "",
      },
      {
        id: 4,
        name: "Diana Prince",
        email: "diana@example.com",
        dob: "1980-08-08",
        locationId: 5,
        isRestricted: false,
        salary: 95000,
        notes: "Project Manager",
      },
      {
        id: 5,
        name: "Ethan Hunt",
        email: "ethan@sample.net",
        dob: "1992-07-19",
        locationId: 1,
        isRestricted: true,
        salary: 88000,
        notes: "Needs access review",
      },
      {
        id: 6,
        name: "Fiona Gallagher",
        email: "fiona@testing.org",
        dob: "1995-03-30",
        locationId: 4,
        isRestricted: false,
        salary: 62000,
        notes: "Junior Staff",
      },
      {
        id: 7,
        name: "George Costanza",
        email: "george@example.com",
        dob: "1975-12-01",
        locationId: 1,
        isRestricted: false,
        salary: 40000,
        notes: "Part-time consultant",
      },
      {
        id: 8,
        name: "Hannah Abbott",
        email: "hannah@sample.net",
        dob: "2000-01-25",
        locationId: 2,
        isRestricted: false,
        salary: 58000,
        notes: null,
      },
      {
        id: 9,
        name: "Ian Malcolm",
        email: "ian@testing.org",
        dob: "1978-09-14",
        locationId: null,
        isRestricted: true,
        salary: 150000,
        notes: "Consultant - High Risk",
      },
      {
        id: 10,
        name: "Jane Doe",
        email: "jane@example.com",
        dob: "1993-06-05",
        locationId: 8,
        isRestricted: false,
        salary: 72000,
        notes: "Standard user",
      },
      // Add more rows to test scrolling
      {
        id: 11,
        name: "Kyle Broflovski",
        email: "kyle@sample.net",
        dob: "1999-05-26",
        locationId: 9,
        isRestricted: false,
        salary: 68000,
        notes: "",
      },
      {
        id: 12,
        name: "Laura Palmer",
        email: "laura@testing.org",
        dob: "1988-07-22",
        locationId: 10,
        isRestricted: true,
        salary: 110000,
        notes: "Requires monitoring",
      },
      {
        id: 13,
        name: "Michael Scott",
        email: "michael@example.com",
        dob: "1970-03-15",
        locationId: 1,
        isRestricted: false,
        salary: 85000,
        notes: "Regional Manager",
      },
      {
        id: 14,
        name: "Nadia Petrova",
        email: "nadia@sample.net",
        dob: "1982-11-08",
        locationId: 9,
        isRestricted: true,
        salary: 130000,
        notes: "Security clearance needed",
      },
      {
        id: 15,
        name: "Oscar Martinez",
        email: "oscar@testing.org",
        dob: "1984-01-12",
        locationId: 1,
        isRestricted: false,
        salary: 78000,
        notes: "Accountant",
      },
      {
        id: 16,
        name: "Pam Beesly",
        email: "pam@example.com",
        dob: "1989-03-25",
        locationId: 1,
        isRestricted: false,
        salary: 60000,
        notes: "Receptionist",
      },
      {
        id: 17,
        name: "Quentin Coldwater",
        email: "quentin@sample.net",
        dob: "1996-09-01",
        locationId: 3,
        isRestricted: false,
        salary: 65000,
        notes: "",
      },
      {
        id: 18,
        name: "Rachel Green",
        email: "rachel@testing.org",
        dob: "1987-05-05",
        locationId: 1,
        isRestricted: false,
        salary: 70000,
        notes: "Fashion Buyer",
      },
      {
        id: 19,
        name: "Steve Rogers",
        email: "steve@example.com",
        dob: "1920-07-04",
        locationId: 1,
        isRestricted: true,
        salary: 200000,
        notes: "Special Project",
      },
      {
        id: 20,
        name: "Tony Stark",
        email: "tony@sample.net",
        dob: "1970-05-29",
        locationId: 1,
        isRestricted: true,
        salary: 500000,
        notes: "CEO - Restricted Access",
      },
      {
        id: 21,
        name: "Ursula Buffay",
        email: "ursula@testing.org",
        dob: "1987-05-05",
        locationId: 1,
        isRestricted: false,
        salary: 45000,
        notes: "Waitress",
      },
      {
        id: 22,
        name: "Victor Frankenstein",
        email: "victor@example.com",
        dob: "1790-10-10",
        locationId: 6,
        isRestricted: true,
        salary: 99000,
        notes: "Research - Confidential",
      },
      {
        id: 23,
        name: "Wendy Darling",
        email: "wendy@sample.net",
        dob: "1900-01-01",
        locationId: 2,
        isRestricted: false,
        salary: 52000,
        notes: "",
      },
      {
        id: 24,
        name: "Xavier Thorpe",
        email: "xavier@testing.org",
        dob: "2002-04-18",
        locationId: 4,
        isRestricted: false,
        salary: 61000,
        notes: "Artist",
      },
      {
        id: 25,
        name: "Yvonne Strahovski",
        email: "yvonne@example.com",
        dob: "1982-07-30",
        locationId: 5,
        isRestricted: true,
        salary: 140000,
        notes: "Agent - Top Secret",
      },
      {
        id: 26,
        name: "Zachary Levi",
        email: "zachary@sample.net",
        dob: "1980-09-29",
        locationId: 1,
        isRestricted: false,
        salary: 100000,
        notes: "Actor",
      },
    ].map((m) => {
      return {
        ...m,
        departmentId: m.locationId
          ? DEPARTMENTS.find((d) => m.locationId === d.locationId)?.id || null
          : null,
      };
    })
  : generateRandomData(20000);

function updateRowSizeText(length: number) {
  document.getElementById("data-size")!.textContent = length.toString();
}
function showContextMenu(x: number, y: number) {
  const contextMenu = document.getElementById("context-menu");
  if (contextMenu) {
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove("hidden");
  }
}
function hideContextMenu() {
  const contextMenu = document.getElementById("context-menu");
  if (contextMenu) {
    contextMenu.classList.add("hidden");
  }
}
// --- Instantiate the Spreadsheet ---
document.addEventListener("DOMContentLoaded", () => {
  updateRowSizeText(sampleData.length);
  let spreadsheet: Spreadsheet | null = null;
  try {
    spreadsheet = new Spreadsheet(
      "spreadsheet-container",
      schema as SpreadsheetSchema,
      [],
      {
        // Optional: Override default options here
        // cellWidth: 180,
        selectedRowBgColor: "#e0e7ff", // light-blue
        onCellsUpdate: (rows: CellUpdateEvent[]) => {
          // selected cell returns row index and column key
          const selectedCell = spreadsheet?.getSelectedCell();
          // custom loading and error state with a specific column updated value checking
          const newUpdatedRows: CellUpdateInput[] = [];
          const locationDepartmentMap = new Map<number, number[]>(
            LOCATIONS.map((l) => [
              l.id,
              DEPARTMENTS.filter((d) => d.locationId === l.id).map((m) => m.id),
            ])
          );
          for (const { rowIndex, columnKeys, data, oldData } of rows) {
            if (
              columnKeys.includes("email") &&
              data.email &&
              data.email.endsWith("@sample.net")
            ) {
              // update single cell
              newUpdatedRows.push({
                rowIndex,
                colKey: "loading:email",
                value: true,
              });
              setTimeout(() => {
                // update multiple cells at once which is more efficient than updating one by one
                spreadsheet?.updateCells([
                  { rowIndex, colKey: "loading:email", value: null },
                  {
                    rowIndex,
                    colKey: "error:email",
                    value: `Account ${data.email} does not exist`,
                  },
                ]);
                // also update our own error state display for the email column
                if (
                  selectedCell?.row === rowIndex &&
                  selectedCell.colKey === "email"
                ) {
                  document.getElementById(
                    "error-container"
                  )!.textContent = `Account ${data.email} does not exist`;
                }
              }, 2000);
            } else if (
              columnKeys.includes("locationId") ||
              columnKeys.includes("departmentId")
            ) {
              if (!data.locationId && data.departmentId) {
                // reset departmentId when locationId is cleared
                newUpdatedRows.push({
                  rowIndex,
                  colKey: "departmentId",
                  value: oldData?.departmentId || null,
                  flashError: "Wrong department",
                });
              } else if (data.departmentId && data.locationId) {
                // validate correct department for location
                const departmentIds = locationDepartmentMap.get(
                  +data.locationId
                );
                if (
                  !departmentIds ||
                  !departmentIds.includes(+data.departmentId)
                ) {
                  newUpdatedRows.push({
                    rowIndex,
                    colKey: "departmentId",
                    value: oldData?.departmentId || null,
                    flashError: "Wrong department",
                  });
                }
              }
            }
          }
          if (newUpdatedRows.length) {
            spreadsheet?.updateCells(newUpdatedRows);
          }
        },
        onCellSelected: ({ rowData, colKey }: CellEvent) => {
          document.getElementById("error-container")!.textContent =
            rowData[`error:${colKey}`] || "";
        },
        onRowDeleted: (rows: DataRow[]) => {
          updateRowSizeText(spreadsheet?.rowCount || 0);
          console.log("deleted rows", rows);
        },
        onColumnDelete: (colIndex: number, schema: ColumnSchema) => {
          console.log("deleting column", colIndex);
          if (
            confirm(`Are you sure you want to delete column ${schema.label}?`)
          ) {
            spreadsheet?.removeColumnByIndex(colIndex);
          }
        },
        onLazySearch: async ({ searchTerm }: CellEventWithSearch) => {
          if (!searchTerm) {
            return null;
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                DEPARTMENTS.filter((d) =>
                  d.name.toLowerCase().includes(searchTerm.toLowerCase())
                )
              );
            }, 2000 + Math.random() * 1000);
          });
        },
        onRowNumberContextMenu: ({
          rowIndex,
          x,
          y,
        }: RowNumberContextMenuEvent) => {
          console.log("row number context menu", rowIndex, x, y);
          showContextMenu(x, y);
        },
        onColumnHeaderContextMenu: ({
          colIndex,
          x,
          y,
        }: ColumnHeaderContextMenuEvent) => {
          console.log("column header context menu", colIndex, x, y);
          showContextMenu(x, y);
        },
        onCellContextMenu: ({
          rowIndex,
          colKey,
          x,
          y,
        }: CellContextMenuEvent) => {
          console.log("cell context menu", rowIndex, colKey, x, y);
          showContextMenu(x, y);
        },
        onEditorOpened: ({ schema }: EditorOpenedEvent) => {
          if (schema.type === "text" && schema.multiline) {
            document
              .querySelector(".spreadsheet-container")
              ?.classList.add("active-cell-editor");
          }
        },
        onEditorClosed: () => {
          document
            .querySelector(".spreadsheet-container")
            ?.classList.remove("active-cell-editor");
        },
        autoResizeRowHeight: true,
        lineHeight: 18, // 18 pixels
        verbose: true,
      }
    );

    (() => {
      const localeStorageData = localStorage.getItem("cs-example-backup");
      if (!localeStorageData) {
        spreadsheet?.setData(sampleData);
        return;
      }
      if (confirm("Load data from local storage?")) {
        const { data, columns } = JSON.parse(localeStorageData) as {
          data: DataRow[];
          columns: string[];
        };
        const existingColumns = spreadsheet?.getColumns();
        const newColumns = columns.filter((c) => !existingColumns.includes(c));
        // we can set schema if we find some columns are deleted, but for this
        // example, we will just add the missing columns
        // If the new columns have dynamic values, we will need to populate the existing
        // values to the new column schema for rendering the names, otherwise those column
        // cells will be empty
        if (newColumns.length) {
          // unique non-null values
          const columnValues = new Set(
            data.map((d) => d[newColumns[0]]).filter((v) => v)
          );
          // find the appropriate label for the values, we know the values are from departments in this example
          const values = Array.from(columnValues)
            .map((v) => DEPARTMENTS.find((d) => d.id === v))
            .filter((f) => f) as SelectOption[];
          spreadsheet?.addColumn(newColumns[0], {
            type: "select",
            label: "Status",
            nullable: true,
            lazySearch: true,
            removable: true,
            values,
          });
        }
        spreadsheet?.setData(data);
        return;
      }
      spreadsheet?.setData(sampleData);
    })();

    // Example of using the API after instantiation
    // setTimeout(async () => {
    //   console.time("data filter time");
    //   const data = await spreadsheet?.getData();
    //   console.timeEnd("data filter time");
    //   console.log("data", data.length);
    // }, 2000);
  } catch (error) {
    console.error("Failed to initialize spreadsheet:", error);
    const container = document.getElementById("spreadsheet-container");
    if (container) {
      container.innerHTML = `<p class="p-4 text-red-600">Error initializing spreadsheet: ${
        error instanceof Error ? error.message : "Unknown error"
      }</p>`;
    }
  }
  document.getElementById("add-row")?.addEventListener("click", () => {
    const newRowIndex = spreadsheet?.addRow();
    updateRowSizeText((newRowIndex || 0) + 1);
  });
  document.addEventListener("click", (event) => {
    if (event.target !== document.getElementById("context-menu")) {
      hideContextMenu();
    }
  });
  document.getElementById("add-column")?.addEventListener("click", () => {
    spreadsheet?.addColumn("status", {
      type: "select",
      label: "Status",
      nullable: true,
      lazySearch: true,
      removable: true,
    });
  });
  document.getElementById("save")?.addEventListener("click", async () => {
    const data = await spreadsheet?.getData();
    console.log("data", data);
  });
  let saving = false;
  setInterval(async () => {
    if (saving) return;
    saving = true;
    document.title = "Saving...";
    try {
      const data = await spreadsheet?.getData({
        keepErrors: true,
        nonLoadingOnly: true,
      });
      if (data?.length) {
        localStorage.setItem(
          "cs-example-backup",
          JSON.stringify({ data, columns: spreadsheet?.getColumns() })
        );
      }
    } catch (error) {
      console.error("Failed to save data:", error);
    }
    saving = false;
    document.title = "canvas-sheet";
  }, 3000);
});
