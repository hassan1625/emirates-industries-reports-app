// Small wrappers that make Polaris web components usable from React 18.
// React 18 does not wire custom-element events or properties, so values come
// from listeners attached through refs, and boolean attributes are passed as
// `true` or left out entirely (a `false` would still render as "present").
import { useEffect, useRef } from "react";

// Keeps one listener for `eventName` attached with the latest handler.
export function useEventListener(ref, eventName, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const listener = (event) => latest.current(event);
    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [ref, eventName]);
}

export const useChangeListener = (ref, handler) => useEventListener(ref, "change", handler);

export function DateInput({ label, name, value, onValue, error }) {
  const ref = useRef(null);
  useChangeListener(ref, (event) => onValue(event.currentTarget.value ?? ""));
  return <s-date-field ref={ref} label={label} name={name} value={value} error={error || undefined} required />;
}

// A Polaris checkbox. React 18 only sets the `checked` attribute, which the
// element ignores once the user has clicked it, so the property is kept in step
// with our state in an effect.
export function Checkbox({ label, name, checked, indeterminate, disabled, details, onChecked }) {
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

// A single-choice dropdown. `options` is [{ value, label }].
export function SelectField({ label, name, value, options, onValue }) {
  const ref = useRef(null);
  useChangeListener(ref, (event) => onValue(event.currentTarget.value ?? ""));
  useEffect(() => {
    if (ref.current) ref.current.value = value;
  }, [value]);
  return (
    <s-select ref={ref} label={label} name={name} value={value}>
      {options.map((option) => (
        <s-option key={option.value} value={option.value} selected={option.value === value || undefined}>
          {option.label}
        </s-option>
      ))}
    </s-select>
  );
}

// A search box reporting what is typed.
export function SearchBox({ label, name, placeholder, value, onValue }) {
  const ref = useRef(null);
  useEventListener(ref, "input", (event) => onValue(event.currentTarget.value ?? ""));
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);
  return <s-search-field ref={ref} label={label} name={name} placeholder={placeholder} value={value} labelAccessibilityVisibility="exclusive" />;
}
