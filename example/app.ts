import { DataRow, Spreadsheet, SpreadsheetSchema, CellUpdateEvent } from "canvas-sheet";
// --- Schema Definition ---
const schema: SpreadsheetSchema = {
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
    // placeholder: "Enter email",
    label: "Email Address",
  },
  dob: { type: "date", label: "Date of Birth" },
  locationId: {
    type: "select",
    label: "Location",
    // tooltip: "Select your location",
    values: [
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
    ],
  },
  isRestricted: { type: "boolean", label: "Restricted" },
  salary: { type: "number", label: "Salary" },
  notes: { type: "text", label: "Notes" },
};

function generateRandomData(numRows: number): DataRow[] {
  return Array.from({ length: numRows }, (_, i) => ({
    id: i + 1,
    name: `Person ${i + 1}`,
    email: `person${i + 1}@example.com`,
    dob: Math.random() < 0.5 ? null : new Date(Math.floor(Math.random() * 10000000000)).toISOString().split('T')[0],
    locationId: Math.random() < 0.5 ? null : Math.floor(Math.random() * 10) + 1,
    isRestricted: Math.random() < 0.5,
    salary: Math.floor(Math.random() * 100000) + 50000,
    notes: `Notes for Person ${i + 1}`,
  }));
}


// --- Sample Data ---
const sampleData = !window.location.search.includes('bigdata') ? [
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
    ["error:email"]: "Invalid email",
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
    locationId: 7,
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
] : generateRandomData(20000);

// --- Custom Cell Disabling Logic ---
function customIsCellDisabled(_rowIndex: number, colKey: string, rowData: DataRow) {
  // Example: Disable the locationId column if 'isRestricted' is true AND location is 'New York' (id: 1)
  return colKey === "locationId" && rowData.isRestricted && rowData.locationId === 1;
}

// --- Instantiate the Spreadsheet ---
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById('data-size')!.textContent = sampleData.length.toString();
  let spreadsheet: Spreadsheet|null = null;
  try {
    spreadsheet = new Spreadsheet(
      "spreadsheet-container",
      schema as SpreadsheetSchema,
      sampleData,
      {
        // Optional: Override default options here
        // cellWidth: 180,
        selectedRowBgColor: '#e0e7ff', // light-blue
        isCellDisabled: customIsCellDisabled, // Pass the custom disabling function
        onCellsUpdate: (rows: CellUpdateEvent[]) => {
          // custom loading and error state with a specific column updated value checking
          const row = rows[0];
          if (row.columnKeys.includes('email') && row.data.email && row.data.email.endsWith('@sample.net')) {
            spreadsheet?.updateCell(row.rowIndex, 'loading:email', true);
            setTimeout(() => {
              spreadsheet?.updateCell(row.rowIndex, 'loading:email', null);
              spreadsheet?.updateCell(row.rowIndex, 'error:email', "error");
            }, 2000);
          }
        },
        verbose: true,
      }
    );

    // Example of using the API after instantiation
    setTimeout(() => {
      console.log("data", spreadsheet?.getData());
    }, 2000);
  } catch (error) {
    console.error("Failed to initialize spreadsheet:", error);
    const container = document.getElementById("spreadsheet-container");
    if (container) {
      container.innerHTML = `<p class="p-4 text-red-600">Error initializing spreadsheet: ${error instanceof Error ? error.message : 'Unknown error'}</p>`;
    }
  }
  document.getElementById("add-row")?.addEventListener("click", () => {
    spreadsheet?.addRow();
  });
  document.getElementById("add-column")?.addEventListener("click", () => {
    spreadsheet?.addColumn("new-column", { type: "text", label: "New Column" });
  });
});