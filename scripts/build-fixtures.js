// Converts the client's sample reports under fixtures/source/ into JSON test
// fixtures (Dev Plan Step 10). Run: npm run build:fixtures
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (p) => fileURLToPath(new URL(p, import.meta.url));

// The client's CSV was double-encoded (UTF-8 read as cp1252); undo the
// sequences that occur in product titles.
const MOJIBAKE = [
  ["â€“", "–"],
  ["â€™", "’"],
  ["â€˜", "‘"],
  ["â€œ", "“"],
  ["â€\u009d", "”"],
];
const fixText = (s) => MOJIBAKE.reduce((acc, [bad, good]) => acc.split(bad).join(good), s);

// Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// CSV header -> fixture key (matches the field keys in app/config/reports).
const GENERAL_COLUMNS = {
  "Order name": ["orderName", "string"],
  "Order Date": ["orderDate", "string"],
  "Sales Channel": ["salesChannel", "string"],
  "POS Location": ["posLocation", "string"],
  "POS Staff": ["posStaff", "string"],
  "Collection Name": ["collectionName", "string"],
  "Product title": ["productTitle", "string"],
  "Product variant SKU at time of sale": ["sku", "string"],
  "Product variant BARCODE": ["barcode", "string"],
  "Product variant price": ["variantPrice", "number"],
  "Product variant price - 5%": ["unitPriceBeforeVat", "number"],
  "Net items sold": ["netItemsSold", "number"],
  "Gross sales": ["grossSales", "number"],
  "Discounts": ["discounts", "number"],
  "Discount Code or Reason": ["discountCodeReason", "string"],
  "Net sales": ["netSales", "number"],
  "Shipping Charges": ["shippingCharges", "number"],
  "Payment Method": ["paymentMethod", "string"],
  "Taxes": ["taxes", "number"],
  "Return Reason": ["returnReason", "string"],
  "Total sales": ["totalSales", "number"],
};

function buildGeneralReport() {
  const [header, ...body] = parseCsv(readFileSync(path("../fixtures/source/general-report.sample.csv"), "utf8").replace(/^\uFEFF/, ""));
  const unknown = header.filter((h) => !GENERAL_COLUMNS[h]);
  if (unknown.length) throw new Error(`Unmapped columns: ${unknown.join(", ")}`);

  const rows = body.map((cells) => {
    const row = {};
    header.forEach((h, i) => {
      const [key, type] = GENERAL_COLUMNS[h];
      const raw = fixText((cells[i] ?? "").trim());
      row[key] = raw === "" ? null : type === "number" ? Number(raw) : raw;
    });
    // Rows without a product are the order-level shipping rows in Shopify's export.
    row.rowType = row.productTitle === null ? "shipping" : "line";
    return row;
  });

  return { source: "general-report.sample.csv", rowCount: rows.length, columns: Object.values(GENERAL_COLUMNS).map(([k]) => k), rows };
}

// Hand-written rows in the Dev Plan §4c layout (Collection Name is a column
// before Product Name, Location Name is a fixed header value). Names/SKUs come
// from the General Report sample; collections and barcodes are invented.
// fixtures/source/stock-report.sample.xlsx is NOT the source of this layout: it
// is an empty template for a different report (Collection Name as a header line).
// [collection, product, sku, barcode, onHand, committed]
const STOCK_ROWS = [
  ["ADEK Uniforms", "PE T-shirt (KG1-GR10)-ADEK", "ADK-TSHT-0003-10", "6290000000011", 40, 4],
  ["ADEK Uniforms", "PE Trouser (KG1-GR10)-ADEK", "ADK-TRSR-0002-10", "6290000000028", 12, 7], // available 5  -> red (boundary)
  ["ADEK Uniforms", "Winter Jacket (KG1-GR10)-ADEK", "ADK-JACT-0001-12", "6290000000035", 13, 7], // available 6  -> not red (boundary)
  ["ADEK Uniforms", "Girls Pinafore (GR1-GR5)-ADEK", "ADK-PINF-0001-10", "6290000000042", 2, 0], // available 2  -> red
  ["ADEK Uniforms", "Long Sleeve Polo T-shirt (KG1-GR10)-ADEK", "ADK-TSHT-0002-12", "6290000000059", 0, 0], // available 0  -> red
  ["ADEK Uniforms", "Boys Trouser (KG1-GR10)-ADEK", "ADK-TRSR-0001-MTM", "6290000000066", 3, 6], // available -3 -> red (oversold)
  ["ATS Uniforms", "Unisex White T-shirt-ATS", "IAT-TSHT-0003-XL", "6290000000073", 250, 10],
  ["ATS Uniforms", "Boys Cargo Pants-ATS", "IAT-TRSR-0015-L", "6290000000080", 6, 0], // available 6  -> not red
  ["ATS Uniforms", "Unisex Sports Pants-ATS", "IAT-TRSR-0013-M", "6290000000097", 5, 0], // available 5  -> red (boundary)
  ["AIS Uniforms", "Unisex PE T-Shirt (GR5-GR12)-AIS", "AIS-TSHT-0002-12", "6290000000103", 90, 15],
  ["AIS Uniforms", "Girls Pinafore (GR4-GR12)-AIS", "AIS-PINF-0003-7", "6290000000110", 8, 2], // available 6  -> not red
  ["Accessories", "Shopping Bag", "BAG-RUSB-0001-001", "6290000000127", 1000, 0],
].map(([collectionName, productName, sku, barcode, onHand, committed]) => ({
  collectionName, productName, sku, barcode,
  stockCommitted: committed,
  stockAvailable: onHand - committed,
  stockOnHand: onHand,
  // Expected result of the "Available <= 5" rule (Dev Plan §4c / Step 40).
  expectLowStockRed: onHand - committed <= 5,
}));

function buildStockReport() {
  return {
    source: "synthetic (Dev Plan §4c layout)",
    synthetic: true,
    locationName: "Emirates Industries LLC Al Quoz",
    columns: ["collectionName", "productName", "sku", "barcode", "stockCommitted", "stockAvailable", "stockOnHand"],
    lowStockThreshold: 5,
    rowCount: STOCK_ROWS.length,
    rows: STOCK_ROWS,
  };
}

const general = buildGeneralReport();
writeFileSync(path("../fixtures/general-report.json"), JSON.stringify(general, null, 2) + "\n");
console.log(`general-report.json: ${general.rowCount} rows (${general.rows.filter((r) => r.rowType === "shipping").length} shipping rows)`);

const stock = buildStockReport();
writeFileSync(path("../fixtures/stock-report.json"), JSON.stringify(stock, null, 2) + "\n");
console.log(`stock-report.json: ${stock.rowCount} rows (${stock.rows.filter((r) => r.expectLowStockRed).length} expected red)`);
