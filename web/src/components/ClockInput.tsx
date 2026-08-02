import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

const CLOCK_VALUE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function ClockInput({
  value,
  onCommit,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "onBlur"
> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const cancelBlur = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft === value) return;
    if (draft === "" || CLOCK_VALUE.test(draft)) {
      setInvalid(false);
      onCommit(draft);
      return;
    }
    setInvalid(true);
    setDraft(value);
  };
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder="HH:mm"
      maxLength={5}
      value={draft}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        setInvalid(false);
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (cancelBlur.current) {
          cancelBlur.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelBlur.current = true;
          setDraft(value);
          setInvalid(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
