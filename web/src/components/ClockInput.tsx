import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { normalizeTimeInput } from "../utils/timeInput";

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
  const [saved, setSaved] = useState(false);
  const cancelBlur = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );
  const commit = () => {
    if (draft === value) return;
    const normalized = normalizeTimeInput(draft);
    if (normalized !== null) {
      setInvalid(false);
      if (normalized === value) {
        setDraft(value);
        return;
      }
      onCommit(normalized);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 650);
      return;
    }
    setInvalid(true);
    setDraft(value);
  };
  return (
    <input
    {...props}
      className={`${props.className ?? ""} clock-input${saved ? " clock-input--saved" : ""}`.trim()}
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
