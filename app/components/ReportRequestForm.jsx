// Request screen form (Dev Plan Step 24). Renders the date range and every
// filter listed in the report's config, so adding a filter to the config adds it
// here. No filter or label is written out in this file.
//
// The app runs React 18, which does not wire custom-element events or
// properties for Polaris web components. Values therefore come from `change`
// listeners attached through refs, and boolean attributes are passed as
// `true` or left out entirely (a `false` would still render as "present").
import { useEffect, useRef, useState } from "react";
import { getReport, getReportFilters, getSelectableFields, hasFieldSelection } from "../config";

// Keeps one listener attached with the latest handler.
function useChangeListener(ref, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const listener = (event) => latest.current(event);
    element.addEventListener("change", listener);
    return () => element.removeEventListener("change", listener);
  }, [ref]);
}

function DateInput({ label, name, value, onValue, error }) {
  const ref = useRef(null);
  useChangeListener(ref, (event) => onValue(event.currentTarget.value ?? ""));
  return <s-date-field ref={ref} label={label} name={name} value={value} error={error || undefined} required />;
}

function ChoiceFilter({ filter, options, values, onValues, error }) {
  const ref = useRef(null);
  useChangeListener(ref, (event) => onValues(event.currentTarget.values ?? []));
  const unavailable = filter.available === false;
  return (
    <s-choice-list
      ref={ref}
      label={filter.label}
      name={filter.key}
      multiple
      disabled={unavailable || undefined}
      details={unavailable ? filter.unavailableReason : "Leave empty to include everything."}
      error={error || undefined}
    >
      {options.map((option) => (
        <s-choice key={option.value} value={option.value} selected={values.includes(option.value) || undefined}>
          {option.label}
        </s-choice>
      ))}
    </s-choice-list>
  );
}

// A Polaris checkbox. React 18 only sets the `checked` attribute, which the
// element ignores once the user has clicked it, so the property is kept in step
// with our state in an effect.
function Checkbox({ label, name, checked, indeterminate, disabled, details, onChecked }) {
  const ref = useRef(null);
  useChangeListener(ref, (event) => onChecked(Boolean(event.currentTarget.checked)));
  useEffect(() => {
    if (!ref.current) return;
    ref.current.checked = Boolean(checked);
    ref.current.indeterminate = Boolean(indeterminate);
  }, [checked, indeterminate]);
  return (
    <s-checkbox
      ref={ref}
      label={label}
      name={name}
      checked={checked || undefined}
      indeterminate={indeterminate || undefined}
      disabled={disabled || undefined}
      details={details}
    />
  );
}

// reportKey  key in app/config/reports
// options    { [filterKey]: [{ value, label }] }
// defaults   { dateRange: { from, to }, fields: [fieldKey] }
// errors     { [filterKey]: message } from the server
// onSubmit   ({ dateRange: { from, to }, filters: { [filterKey]: string[] }, fields?: string[] })
export default function ReportRequestForm({ reportKey, options, defaults, errors = {}, busy = false, onSubmit }) {
  const report = getReport(reportKey);
  const filters = getReportFilters(reportKey);
  const dateFilter = filters.find((f) => f.type === "dateRange");
  const selectFilters = filters.filter((f) => f.type === "multiSelect" || f.type === "singleSelect");

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

  const submit = () => onSubmit({ dateRange: { from, to }, filters: selected, ...(withFields ? { fields } : {}) });

  return (
    <s-page heading={report.label}>
      <s-button slot="primary-action" variant="primary" onClick={submit} loading={busy || undefined}>
        Generate report
      </s-button>

      {dateFilter && (
        <s-section heading={dateFilter.label}>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <DateInput label="From" name={`${dateFilter.key}-from`} value={from} onValue={setFrom} error={errors[dateFilter.key]} />
            <DateInput label="To" name={`${dateFilter.key}-to`} value={to} onValue={setTo} />
          </s-grid>
        </s-section>
      )}

      {selectFilters.length > 0 && (
        <s-section heading="Filters">
          <s-stack gap="base">
            {selectFilters.map((filter) => (
              <ChoiceFilter
                key={filter.key}
                filter={filter}
                options={options[filter.key] ?? []}
                values={selected[filter.key] ?? []}
                onValues={(values) => setSelected((current) => ({ ...current, [filter.key]: values }))}
                error={errors[filter.key]}
              />
            ))}
          </s-stack>
        </s-section>
      )}
      {withFields && (
        <s-section heading="Fields">
          <s-stack gap="base">
            <s-paragraph>
              {chosenCount} of {selectable.length} fields selected. Choose the columns to include in the report.
            </s-paragraph>
            <Checkbox
              label="Select all"
              name="selectAllFields"
              checked={chosenCount === selectable.length}
              indeterminate={chosenCount > 0 && chosenCount < selectable.length}
              onChecked={(on) => setFields(on ? selectable : [])}
            />
            <s-grid gridTemplateColumns="repeat(auto-fill, minmax(240px, 1fr))" gap="small">
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
    </s-page>
  );
}
