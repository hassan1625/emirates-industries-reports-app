// ReportJob.stage values. The column is a plain string (SQLite has no enums),
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
  DATA_READY: "DATA_READY", // all three files on disk; the report file is built next
  GENERATING: "GENERATING", // the XLSX is being written
  READY: "READY", // the report file exists and can be downloaded
  FAILED: "FAILED",
});

// The exports a job runs, one after another (Shopify allows one bulk export at
// a time per store): orders, then the dated events, then products.
export const EXPORTS = Object.freeze(["orders", "events", "products"]);
export const NEXT_EXPORT = Object.freeze({ orders: "events", events: "products" });
export const EXPORT_LABEL = Object.freeze({ orders: "orders", events: "returns and exchanges", products: "products" });

// Stages that wait on Shopify, and the stage a finished export moves a job to.
export const RUNNING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_RUNNING,
  events: STAGES.EVENTS_RUNNING,
  products: STAGES.PRODUCTS_RUNNING,
});
export const DOWNLOADING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_DOWNLOADING,
  events: STAGES.EVENTS_DOWNLOADING,
  products: STAGES.PRODUCTS_DOWNLOADING,
});
// Where a job rests once an export's file is on disk and the next one is not
// running yet. The last export (products) goes straight to DATA_READY.
export const READY_STAGE = Object.freeze({
  orders: STAGES.ORDERS_READY,
  events: STAGES.EVENTS_READY,
});
// ReportJob columns that record each export.
export const BULK_ID_COLUMN = Object.freeze({ orders: "ordersBulkOpId", events: "eventsBulkOpId", products: "productsBulkOpId" });
export const FILE_COLUMN = Object.freeze({ orders: "ordersFile", events: "eventsFile", products: "productsFile" });

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
  [STAGES.DATA_READY]: { label: "Building the report", detail: "All data has been received; creating the Excel file.", progress: 92, terminal: false },
  [STAGES.GENERATING]: { label: "Building the report", detail: "Creating the Excel file.", progress: 96, terminal: false },
  [STAGES.READY]: { label: "Report ready", detail: "Your report file is ready.", progress: 100, terminal: true },
  [STAGES.FAILED]: { label: "Failed", detail: "The report could not be prepared.", progress: 0, terminal: true },
});

export const isTerminalStage = (stage) => STAGE_INFO[stage]?.terminal ?? true;
