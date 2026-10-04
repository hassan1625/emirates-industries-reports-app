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
