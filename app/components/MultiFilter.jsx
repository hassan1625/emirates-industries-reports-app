// A compact multi-select filter: a search box, the chosen values as removable
// chips, and a short scrollable list of choices that opens on demand. Replaces
// the long open checkbox lists, which made the page several screens tall.
// Leave it empty to include everything.
import { useState } from "react";
import { Checkbox, SearchBox } from "./polaris-inputs";

const LIST_STYLE = { maxHeight: 220, overflowY: "auto", border: "1px solid var(--p-color-border, #d5d5d5)", borderRadius: 8, padding: 8, display: "grid", gap: 4 };

// filter   { key, label, allLabel }
// options  [{ value, label }]
// values   chosen values
// onValues (values) => void
export default function MultiFilter({ filter, options, values, onValues, error, defaultOpen = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const labelOf = new Map(options.map((option) => [option.value, option.label]));
  const needle = query.trim().toLowerCase();
  const matches = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const showList = open || needle.length > 0;
  const toggle = (value, on) => onValues(on ? [...new Set([...values, value])] : values.filter((v) => v !== value));

  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" justifyContent="space-between" alignItems="center">
        <s-text type="strong">{filter.label}</s-text>
        <s-text color="subdued">{values.length ? `${values.length} selected` : (filter.allLabel ?? "All")}</s-text>
      </s-stack>
      <SearchBox label={`Search ${filter.label}`} name={`${filter.key}-search`} placeholder={`Search ${filter.label}`} value={query} onValue={setQuery} />
      {values.length > 0 && (
        <s-stack direction="inline" gap="small-300">
          {values.map((value) => (
            <s-clickable-chip key={value} removable accessibilityLabel={`Remove ${labelOf.get(value) ?? value}`} onClick={() => toggle(value, false)}>
              {labelOf.get(value) ?? value}
            </s-clickable-chip>
          ))}
          <s-button variant="tertiary" onClick={() => onValues([])}>
            Clear
          </s-button>
        </s-stack>
      )}
      <s-stack direction="inline">
        <s-button variant="tertiary" onClick={() => setOpen(!open)}>
          {showList ? "Hide choices" : `Choose from ${options.length}`}
        </s-button>
      </s-stack>
      {showList && (
        <div style={LIST_STYLE} role="group" aria-label={filter.label}>
          {matches.length === 0 && <s-text color="subdued">No matches</s-text>}
          {matches.map((option) => (
            <Checkbox key={option.value} label={option.label} name={`${filter.key}-${option.value}`} checked={values.includes(option.value)} onChecked={(on) => toggle(option.value, on)} />
          ))}
        </div>
      )}
      {error && <s-text tone="critical">{error}</s-text>}
    </s-stack>
  );
}
