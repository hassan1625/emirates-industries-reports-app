// ReportJob.stage values. The column is a plain string (SQLite has no enums),
// so this file is the single list of allowed values.
export const STAGES = Object.freeze({
  PENDING: "PENDING", // job created, nothing started
  ORDERS_RUNNING: "ORDERS_RUNNING", // orders bulk export running at Shopify
  ORDERS_DOWNLOADING: "ORDERS_DOWNLOADING", // webhook received, file being downloaded
  ORDERS_READY: "ORDERS_READY", // orders file on disk, products export not started yet
  PRODUCTS_RUNNING: "PRODUCTS_RUNNING", // products/collections export running at Shopify
  PRODUCTS_DOWNLOADING: "PRODUCTS_DOWNLOADING",
  DATA_READY: "DATA_READY", // both files on disk; ready to join (Milestone 3)
  FAILED: "FAILED",
});

// Stages that wait on Shopify, and the stage a finished export moves a job to.
export const RUNNING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_RUNNING,
  products: STAGES.PRODUCTS_RUNNING,
});
export const DOWNLOADING_STAGE = Object.freeze({
  orders: STAGES.ORDERS_DOWNLOADING,
  products: STAGES.PRODUCTS_DOWNLOADING,
});

// What the request screen shows for each stage. `step` orders the progress list;
// `terminal` stages stop the screen polling.
export const STAGE_INFO = Object.freeze({
  [STAGES.PENDING]: { label: "Starting", detail: "Preparing your request.", progress: 5, terminal: false },
  [STAGES.ORDERS_RUNNING]: { label: "Collecting orders", detail: "Shopify is preparing the orders for your date range.", progress: 25, terminal: false },
  [STAGES.ORDERS_DOWNLOADING]: { label: "Downloading orders", detail: "Receiving the orders from Shopify.", progress: 50, terminal: false },
  [STAGES.ORDERS_READY]: { label: "Orders received", detail: "Asking Shopify for products and collections.", progress: 55, terminal: false },
  [STAGES.PRODUCTS_RUNNING]: { label: "Collecting products", detail: "Shopify is preparing products and collections.", progress: 75, terminal: false },
  [STAGES.PRODUCTS_DOWNLOADING]: { label: "Downloading products", detail: "Receiving products and collections.", progress: 90, terminal: false },
  [STAGES.DATA_READY]: { label: "Data ready", detail: "All data has been received.", progress: 100, terminal: true },
  [STAGES.FAILED]: { label: "Failed", detail: "The report could not be prepared.", progress: 0, terminal: true },
});

export const isTerminalStage = (stage) => STAGE_INFO[stage]?.terminal ?? true;
