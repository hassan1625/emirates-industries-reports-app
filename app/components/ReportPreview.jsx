// TEMPORARY testing aid (Dev Plan Step 26): totals and sample rows for a
// finished job, so numbers can be checked before the XLSX download exists
// (Milestone 5). The plan has no in-app dashboards; remove this with that step.
const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT_KEYS = new Set(["orders", "itemsSold"]);
const TOTAL_COLUMNS = [
  ["orders", "Orders"],
  ["itemsSold", "Items"],
  ["gross", "Gross"],
  ["discounts", "Discount"],
  ["returns", "Returns"],
  ["net", "Net"],
  ["shipping", "Ship ex VAT"],
  ["taxes", "Tax"],
  ["total", "Total"],
];

function TotalsTable({ rows, keyLabel }) {
  return (
    <table style={{ borderCollapse: "collapse", marginBottom: 16 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "2px 10px" }}>{keyLabel}</th>
          {TOTAL_COLUMNS.map(([key, label]) => (
            <th key={key} style={{ textAlign: "right", padding: "2px 10px" }}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td style={{ padding: "2px 10px" }}>{row.key}</td>
            {TOTAL_COLUMNS.map(([key]) => (
              <td key={key} style={{ textAlign: "right", padding: "2px 10px" }}>
                {row[key] === null ? "–" : COUNT_KEYS.has(key) ? row[key].toLocaleString("en-US") : fmt(row[key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// preview  result of previewJob(): totals, byMonth, byDay, byLocation,
//          byChannel, byCollection, columns [{ key, label }], sample [values]
export default function ReportPreview({ preview }) {
  return (
    <s-section heading="Test preview (temporary)">
      <s-stack gap="base">
        <s-banner tone="warning" heading="For checking numbers only">
          This preview applies your filters and shows your chosen columns. It will be replaced by the file download.
        </s-banner>
        <TotalsTable rows={[{ key: "All rows", ...preview.totals }]} keyLabel="" />
        <h4>By month</h4>
        <TotalsTable rows={preview.byMonth} keyLabel="Month" />
        <h4>By day</h4>
        <TotalsTable rows={preview.byDay} keyLabel="Day" />
        <h4>By location</h4>
        <TotalsTable rows={preview.byLocation} keyLabel="Location" />
        <h4>By sales channel</h4>
        <TotalsTable rows={preview.byChannel} keyLabel="Channel" />
        <h4>By collection (rows)</h4>
        <TotalsTable rows={preview.byCollection} keyLabel="Collection" />
        <h4>First {preview.sample.length} rows</h4>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {preview.columns.map((column) => (
                  <th key={column.key} style={{ textAlign: "left", padding: "2px 8px", whiteSpace: "nowrap" }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((values, index) => (
                <tr key={index}>
                  {preview.columns.map((column) => (
                    <td key={column.key} style={{ padding: "2px 8px", whiteSpace: "nowrap" }}>
                      {values[column.key] === null || values[column.key] === undefined ? "" : String(values[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-stack>
    </s-section>
  );
}
