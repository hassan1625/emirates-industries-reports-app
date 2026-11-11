// ReportJob.stage values. The column is a plain string (not a database enum),
// so this file is the single list of allowed values.
export const STAGES = Object.freeze({
  PENDING: "PENDING", // job created, nothing started
  ORDERS_RUNNING: "ORDERS_RUNNING", // orders bulk export running at Shopify
  ORDERS_DOWNLOADING: "ORDERS_DOWNLOADING", // webhook received, file being downloaded
  ORDERS_READY: "ORDERS_READY", // orders file on disk, events export not started yet
  EVENTS_RUNNING: "EVENTS_RUNNING", // dated sales events (orders, returns, exchanges) running at Shopify
  EVENTS_DOWNLOADING: "EVENTS_DOWNLOADING",
  EVENTS_READY: "EVENTS_READY", // events file on disk, products export not started yet
  PRODUCTS_RUNNING: "PRODUCTS_RUNNING", // products/collections export running at Shopify
  PRODUCTS_DOWNLOADING: "PRODUCTS_DOWNLOADING",
  PRODUCTS_READY: "PRODUCTS_READY", // products file on disk, inventory export not started yet (stock reports)
  INVENTORY_RUNNING: "INVENTORY_RUNNING", // stock levels per location running at Shopify
  INVENTORY_DOWNLOADING: "INVENTORY_DOWNLOADING",
  DATA_READY: "DATA_READY", // every file of the job is on disk; the report file is built next
  GENERATING: "GENERATING", // the XLSX is being written
  READY: "READY", // the report file exists and can be downloaded
  EXPIRED: "EXPIRED", // the file was deleted after the retention period
  FAILED: "FAILED",
});

// The exports a job runs, one after another (Shopify allows one bulk export at
// a time per store). Sales reports collect the orders, then the dated events,
// then the products; the stock report collects the products, then the stock
// levels. `exportSequence` says which, per report type.
export const EXPORTS = Object.freeze(["orders", "events", "products", "inventory"]);
export const SALES_EXPORTS = Object.freeze(["orders", "events", "products"]);
export const STOCK_EXPORTS = Object.freeze(["products", "inventory"]);
export const STOCK_REPORT_TYPES = Object.freeze(["stockByLocation"]);
export const EXPORT_LABEL = Object.freeze({ orders: "orders", events: "returns and exchanges", products: "products", inventory: "stock levels" });

export const exportSequence = (reportType) => (STOCK_REPORT_TYPES.includes(reportType) ? STOCK_EXPORTS : SALES_EXPORTS);
export const firstExport = (reportType) => exportSequence(reportType)[0];
// The export after `which` for this report type, or undefined after the last.
export const nextExport = (reportType, which) => {
  const sequence = exportSequence(reportType);
  return sequence[sequence.indexOf(which) + 1];
};

// Stages that wait on Shopify, and the stage a finished export moves a job to.
export const RUNNING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_RUNNING,
  events: STAGES.EVENTS_RUNNING,
  products: STAGES.PRODUCTS_RUNNING,
  inventory: STAGES.INVENTORY_RUNNING,
});
export const DOWNLOADING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_DOWNLOADING,
  events: STAGES.EVENTS_DOWNLOADING,
  products: STAGES.PRODUCTS_DOWNLOADING,
  inventory: STAGES.INVENTORY_DOWNLOADING,
});
// Where a job rests once an export's file is on disk and the next one is not
// running yet. After a report's last export the job goes straight to DATA_READY.
export const READY_STAGE = Object.freeze({
  orders: STAGES.ORDERS_READY,
  events: STAGES.EVENTS_READY,
  products: STAGES.PRODUCTS_READY,
});
// ReportJob columns that record each export.
export const BULK_ID_COLUMN = Object.freeze({ orders: "ordersBulkOpId", events: "eventsBulkOpId", products: "productsBulkOpId", inventory: "inventoryBulkOpId" });
export const FILE_COLUMN = Object.freeze({ orders: "ordersFile", events: "eventsFile", products: "productsFile", inventory: "inventoryFile" });

// Which export a stage belongs to, or null.
export const exportOfStage = (stage) => EXPORTS.find((name) => [RUNNING_STAGE[name], DOWNLOADING_STAGE[name], READY_STAGE[name]].includes(stage)) ?? null;

// What the request screen shows for each stage. `progress` orders the progress
// bar; `terminal` stages stop the screen polling.
export const STAGE_INFO = Object.freeze({
  [STAGES.PENDING]: { label: "Starting", detail: "Preparing your request.", progress: 5, terminal: false },
  [STAGES.ORDERS_RUNNING]: { label: "Collecting orders", detail: "Shopify is preparing the orders for your date range. This can take a few minutes.", progress: 15, terminal: false },
  [STAGES.ORDERS_DOWNLOADING]: { label: "Downloading orders", detail: "Receiving the orders from Shopify.", progress: 30, terminal: false },
  [STAGES.ORDERS_READY]: { label: "Orders received", detail: "Asking Shopify for the returns and exchanges.", progress: 35, terminal: false },
  [STAGES.EVENTS_RUNNING]: { label: "Collecting returns and exchanges", detail: "Shopify is preparing the sales, returns and exchanges with their dates. This can take a few minutes.", progress: 50, terminal: false },
  [STAGES.EVENTS_DOWNLOADING]: { label: "Downloading returns and exchanges", detail: "Receiving the returns and exchanges from Shopify.", progress: 65, terminal: false },
  [STAGES.EVENTS_READY]: { label: "Returns and exchanges received", detail: "Asking Shopify for products and collections.", progress: 70, terminal: false },
  [STAGES.PRODUCTS_RUNNING]: { label: "Collecting products", detail: "Shopify is preparing products and collections.", progress: 80, terminal: false },
  [STAGES.PRODUCTS_DOWNLOADING]: { label: "Downloading products", detail: "Receiving products and collections.", progress: 90, terminal: false },
  [STAGES.PRODUCTS_READY]: { label: "Products received", detail: "Asking Shopify for the stock levels.", progress: 50, terminal: false },
  [STAGES.INVENTORY_RUNNING]: { label: "Collecting stock levels", detail: "Shopify is preparing the stock levels of every location. This can take a few minutes.", progress: 65, terminal: false },
  [STAGES.INVENTORY_DOWNLOADING]: { label: "Downloading stock levels", detail: "Receiving the stock levels from Shopify.", progress: 85, terminal: false },
  [STAGES.DATA_READY]: { label: "Building the report", detail: "All data has been received; creating the Excel file.", progress: 92, terminal: false },
  [STAGES.GENERATING]: { label: "Building the report", detail: "Creating the Excel file.", progress: 96, terminal: false },
  [STAGES.READY]: { label: "Report ready", detail: "Your report file is ready.", progress: 100, terminal: true },
  [STAGES.EXPIRED]: { label: "Expired", detail: "This report was removed after the retention period. Generate it again.", progress: 0, terminal: true },
  [STAGES.FAILED]: { label: "Failed", detail: "The report could not be prepared.", progress: 0, terminal: true },
});

export const isTerminalStage = (stage) => STAGE_INFO[stage]?.terminal ?? true;

// The steps the screen lists while a report builds. Each covers the stages of
// one export; the last covers building the file (staff names are looked up
// there). `progressSteps(reportType)` gives a report's list and `stepOfStage`
// the step a stage belongs to in it, or -1.
const SALES_STEPS = Object.freeze([
  { label: "Collecting orders", stages: [STAGES.PENDING, STAGES.ORDERS_RUNNING, STAGES.ORDERS_DOWNLOADING, STAGES.ORDERS_READY] },
  { label: "Collecting returns and exchanges", stages: [STAGES.EVENTS_RUNNING, STAGES.EVENTS_DOWNLOADING, STAGES.EVENTS_READY] },
  { label: "Collecting products", stages: [STAGES.PRODUCTS_RUNNING, STAGES.PRODUCTS_DOWNLOADING] },
  { label: "Looking up staff and building the Excel file", stages: [STAGES.DATA_READY, STAGES.GENERATING] },
]);
const STOCK_STEPS = Object.freeze([
  { label: "Collecting products", stages: [STAGES.PENDING, STAGES.PRODUCTS_RUNNING, STAGES.PRODUCTS_DOWNLOADING, STAGES.PRODUCTS_READY] },
  { label: "Collecting stock levels", stages: [STAGES.INVENTORY_RUNNING, STAGES.INVENTORY_DOWNLOADING] },
  { label: "Building the Excel file", stages: [STAGES.DATA_READY, STAGES.GENERATING] },
]);

export const progressSteps = (reportType) => (STOCK_REPORT_TYPES.includes(reportType) ? STOCK_STEPS : SALES_STEPS);
export const stepOfStage = (stage, reportType) => progressSteps(reportType).findIndex((step) => step.stages.includes(stage));
