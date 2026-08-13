import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { normalizeTimeInput } from "../utils/timeInput";
import { useTranslation } from "react-i18next";

export function ClockInput({
  value,
  onCommit,
  onDraftChange,
  onNavigate,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "onBlur"
> & {
  value: string;
  onCommit: (value: string) => void | Promise<void>;
  onDraftChange?: (value: string) => void;
  onNavigate?: (direction: "next" | "previous") => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelBlur = useRef(false);
  const wholeCellSelected = useRef(false);
  const commitInFlight = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!commitInFlight.current) setDraft(value);
  }, [value]);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );
  const commit = async (direction?: "next" | "previous") => {
    if (commitInFlight.current) return;
    if (draft === value) {
      if (direction) navigate(direction);
      return;
    }
    const normalized = normalizeTimeInput(draft);
    if (normalized !== null) {
      setInvalid(false);
      if (normalized === value) {
        setDraft(value);
        navigate(direction ?? "next");
        return;
      }
      commitInFlight.current = true;
      setSaving(true);
      setError(null);
      try {
        await onCommit(normalized);
        setDraft(value === "" && normalized !== "" ? "" : normalized);
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 650);
        navigate(direction ?? "next");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("common.status.changeFailed", "Uložení selhalo."));
        setInvalid(true);
      } finally {
        commitInFlight.current = false;
        setSaving(false);
      }
      return;
    }
    setInvalid(true);
    setError(t("errors.invalid_time_format", "Neplatný čas, použijte HH:MM."));
  };
  const handleBlur = () => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    void commit();
  };
  const navigate = (direction: "next" | "previous") => {
    if (onNavigate) {
      onNavigate(direction);
      return;
    }
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input.clock-input:not(:disabled)"));
    const index = inputs.indexOf(document.activeElement as HTMLInputElement);
    inputs[index + (direction === "next" ? 1 : -1)]?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelBlur.current = true;
      setDraft(value);
      setInvalid(false);
      setError(null);
      event.currentTarget.blur();
      return;
    }
    const selectionCoversValue = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === draft.length;
    if (event.key === "Delete" && (wholeCellSelected.current || selectionCoversValue)) {
      event.preventDefault();
      setDraft("");
      onDraftChange?.("");
      wholeCellSelected.current = false;
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      void commit(event.shiftKey ? "previous" : "next");
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      wholeCellSelected.current = false;
    }
  };
  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    wholeCellSelected.current = true;
    event.currentTarget.select();
    setError(null);
  };
  return (
    <>
      <input
        {...props}
        className={`${props.className ?? ""} clock-input${saving ? " clock-input--saving" : ""}${saved ? " clock-input--saved" : ""}${error ? " clock-input--error" : ""}`.trim()}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        maxLength={5}
        value={draft}
        aria-invalid={invalid || undefined}
        aria-busy={saving || undefined}
        onChange={(event) => {
          setInvalid(false);
          setError(null);
          wholeCellSelected.current = false;
          setDraft(event.target.value);
          onDraftChange?.(event.target.value);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {saving ? t("common.status.saving", "Ukládám") : saved ? t("common.status.saved") : error ?? ""}
      </span>
    </>
  );
}
