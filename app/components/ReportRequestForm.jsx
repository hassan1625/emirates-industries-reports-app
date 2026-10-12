// Request screen form (Dev Plan Step 24, redesigned). Renders the date range and
// every filter listed in the report's config, so adding a filter to the config
// adds it here. No filter or label is written out in this file.
//
// Layout: the report status card first (so the result is visible right after
// Generate), then the date range, compact searchable filters and the column
// choice, with a Summary of the request beside them.
import { useState } from "react";
import { getReport, getReportFilters, getSelectableFields, hasFieldSelection } from "../config";
import { DATE_PRESETS, matchPreset, presetRange } from "../pipeline/date-presets";
import MultiFilter from "./MultiFilter";
import { Checkbox, DateInput, SelectField } from "./polaris-inputs";

// The Summary stays in view while the form scrolls.
const STICKY = { position: "sticky", top: 16 };

// reportKey  key in app/config/reports
// options    { [filterKey]: [{ value, label }] }
// defaults   { dateRange: { from, to }, today?, fields: [fieldKey] }
// errors     { [filterKey]: message } from the server
// renderStatus  ({ submit, clearFilters }) => node, shown first (the status card)
// children   rendered after the form (the Recent reports list)
// onSubmit   ({ dateRange: { from, to }, filters: { [filterKey]: string[] }, fields?: string[] })
export default function ReportRequestForm({ reportKey, options, defaults, errors = {}, busy = false, onSubmit, renderStatus, children }) {
  const report = getReport(reportKey);
  const filters = getReportFilters(reportKey);
  const dateFilter = filters.find((f) => f.type === "dateRange");
  const selectFilters = filters.filter((f) => (f.type === "multiSelect" || f.type === "singleSelect") && f.available !== false);

  const today = defaults.today ?? defaults.dateRange.to;
  const [from, setFrom] = useState(defaults.dateRange.from);
  const [to, setTo] = useState(defaults.dateRange.to);
  const [selected, setSelected] = useState({});

  // Field selection (reports that offer it). Selectable = has data on this plan.
  const withFields = hasFieldSelection(reportKey);
  const fieldList = withFields ? getSelectableFields(reportKey) : [];
  const selectable = fieldList.filter((field) => field.available).map((field) => field.key);
  const [fields, setFields] = useState(defaults.fields ?? selectable);
  const chosenCount = selectable.filter((key) => fields.includes(key)).length;
  const toggleField = (key, on) => setFields((current) => (on ? [...new Set([...current, key])] : current.filter((k) => k !== key)));

  const preset = matchPreset(from, to, today);
  const choosePreset = (key) => {
    const range = presetRange(key, today);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const submit = () => onSubmit({ dateRange: { from, to }, filters: selected, ...(withFields ? { fields } : {}) });
  const clearFilters = () => setSelected({});
  const summarize = (filter) => ((selected[filter.key] ?? []).length ? `${selected[filter.key].length} selected` : (filter.allLabel ?? "All"));

  return (
    <s-page heading={report.label}>
      <s-button slot="primary-action" variant="primary" onClick={submit} loading={busy || undefined}>
        Generate report
      </s-button>
      {report.description && (
        <s-section>
          <s-text color="subdued">{report.description}</s-text>
        </s-section>
      )}

      {renderStatus?.({ submit, clearFilters })}

      {dateFilter && (
        <s-section heading={dateFilter.label}>
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <SelectField label="Period" name="period" value={preset} options={DATE_PRESETS.map(({ key, label }) => ({ value: key, label }))} onValue={choosePreset} />
            <DateInput label="Start date" name={`${dateFilter.key}-from`} value={from} onValue={setFrom} error={errors[dateFilter.key]} />
            <DateInput label="End date" name={`${dateFilter.key}-to`} value={to} onValue={setTo} />
          </s-grid>
        </s-section>
      )}

      {selectFilters.length > 0 && (
        <s-section heading="Filters">
          <s-stack gap="base">
            <s-text color="subdued">All optional. Leave a filter empty to include everything.</s-text>
            <s-grid gridTemplateColumns="1fr 1fr" gap="large">
              {selectFilters.map((filter) => (
                <MultiFilter
                  key={filter.key}
                  filter={filter}
                  options={options[filter.key] ?? []}
                  values={selected[filter.key] ?? []}
                  onValues={(values) => setSelected((current) => ({ ...current, [filter.key]: values }))}
                  error={errors[filter.key]}
                />
              ))}
            </s-grid>
          </s-stack>
        </s-section>
      )}

      {withFields && (
        <s-section heading="Columns">
          <s-stack gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-text color="subdued">
                {chosenCount} of {selectable.length} selected · shown in this order in the file
              </s-text>
              <s-stack direction="inline" gap="small">
                <s-button variant="tertiary" onClick={() => setFields(selectable)}>
                  Select all
                </s-button>
                <s-button variant="tertiary" onClick={() => setFields([])}>
                  Clear
                </s-button>
              </s-stack>
            </s-stack>
            <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="small">
              {fieldList.map((field) => (
                <Checkbox
                  key={field.key}
                  label={field.label}
                  name={field.key}
                  checked={field.available && fields.includes(field.key)}
                  disabled={!field.available}
                  details={field.available ? undefined : field.unavailableReason}
                  onChecked={(on) => toggleField(field.key, on)}
                />
              ))}
            </s-grid>
            {errors.fields && <s-banner tone="critical">{errors.fields}</s-banner>}
          </s-stack>
        </s-section>
      )}

      <div slot="aside" style={STICKY}>
        <s-section heading="Summary">
          <s-stack gap="small">
            <SummaryRow label="Dates" value={`${from} to ${to}`} />
            {selectFilters.map((filter) => (
              <SummaryRow key={filter.key} label={filter.label} value={summarize(filter)} />
            ))}
            {withFields && <SummaryRow label="Columns" value={`${chosenCount} of ${selectable.length}`} />}
            <SummaryRow label="File" value="Excel (.xlsx)" />
          </s-stack>
        </s-section>
      </div>

      {children}
    </s-page>
  );
}

function SummaryRow({ label, value }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong">{value}</s-text>
    </s-stack>
  );
}
