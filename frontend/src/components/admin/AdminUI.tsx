import React from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import Button from "../../ui/Button";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader(props: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="admin-header">
      <div className="admin-header-copy">
        {props.eyebrow ? <div className="admin-header-eyebrow">{props.eyebrow}</div> : null}
        <h1 className="admin-header-title">{props.title}</h1>
        {props.description ? <p className="admin-header-description">{props.description}</p> : null}
        {props.children}
      </div>
      {props.actions ? <div className="admin-header-actions">{props.actions}</div> : null}
    </header>
  );
}

export function MetricCard(props: { label: string; value: React.ReactNode; hint?: string; tone?: "default" | "accent" | "danger" | "ok" }) {
  return (
    <section className={cx("admin-metric-card", props.tone && `admin-metric-card--${props.tone}`)}>
      <div className="admin-metric-label">{props.label}</div>
      <div className="admin-metric-value">{props.value}</div>
      {props.hint ? <div className="admin-metric-hint">{props.hint}</div> : null}
    </section>
  );
}

export function StateBadge(props: { children: React.ReactNode; tone?: "default" | "ok" | "warning" | "danger" | "accent" }) {
  return <span className={cx("admin-badge", props.tone && `admin-badge--${props.tone}`)}>{props.children}</span>;
}

export function FilterBar(props: { children: React.ReactNode }) {
  return <div className="admin-filter-bar">{props.children}</div>;
}

export function EmptyState(props: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="admin-empty-state">
      <div className="admin-empty-title">{props.title}</div>
      <div className="admin-empty-description">{props.description}</div>
      {props.action ? <div className="admin-empty-action">{props.action}</div> : null}
    </div>
  );
}

export function InlineNotice(props: { tone?: "default" | "warning" | "danger" | "ok"; children: React.ReactNode }) {
  return <div className={cx("admin-inline-notice", props.tone && `admin-inline-notice--${props.tone}`)}>{props.children}</div>;
}

export function ActionLink(props: { to: string; label: string }) {
  return (
    <NavLink to={props.to} className="admin-action-link">
      {props.label}
    </NavLink>
  );
}

export function Breadcrumbs(props: { items: Array<{ label: string; to?: string }> }) {
  if (props.items.length === 0) return null;
  return (
    <nav className="admin-breadcrumbs" aria-label="Drobečková navigace">
      {props.items.map((item, index) => {
        const isLast = index === props.items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {item.to && !isLast ? (
              <NavLink className="admin-breadcrumb-link" to={item.to}>
                {item.label}
              </NavLink>
            ) : (
              <span className="admin-breadcrumb-current" aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
            {!isLast ? <span className="admin-breadcrumb-separator" aria-hidden="true">/</span> : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  details?: Array<{ label: string; value: React.ReactNode }>;
  confirmTextLabel?: string;
  confirmTextValue?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = React.useState("");
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!props.open) {
      setConfirmText("");
      return;
    }

    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        props.confirmTextValue ? "input, button, [href], select, textarea, [tabindex]:not([tabindex='-1'])" : "button",
      );
      target?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [props]);

  if (!props.open || typeof document === "undefined") return null;

  const confirmLocked = Boolean(props.confirmTextValue) && confirmText.trim() !== props.confirmTextValue;

  return createPortal(
    <div className="admin-dialog-backdrop" role="presentation" onClick={props.onClose}>
      <div
        ref={dialogRef}
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-dialog-head">
          <div className="admin-dialog-title">{props.title}</div>
          {props.description ? <div className="admin-dialog-description">{props.description}</div> : null}
        </div>
        {props.details && props.details.length > 0 ? (
          <div className="admin-dialog-body">
            <div className="admin-dialog-grid">
              {props.details.map((detail) => (
                <div key={detail.label} className="admin-dialog-stat">
                  <div className="admin-dialog-stat-label">{detail.label}</div>
                  <div className="admin-dialog-stat-value">{detail.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {props.confirmTextValue ? (
          <div className="admin-dialog-body">
            <label className="kb-field">
              <span className="kb-label">{props.confirmTextLabel ?? `Pro potvrzení napište ${props.confirmTextValue}`}</span>
              <input
                className="kb-input"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="admin-confirm-text-help"
              />
            </label>
            <div id="admin-confirm-text-help" className="kb-help">
              Přesně opište text <strong>{props.confirmTextValue}</strong>.
            </div>
          </div>
        ) : null}
        <div className="admin-dialog-actions">
          <Button type="button" variant="ghost" onClick={props.onClose} disabled={props.busy}>
            {props.cancelLabel ?? "Zrušit"}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={props.tone === "danger" ? "danger" : "primary"}
            onClick={props.onConfirm}
            disabled={props.busy || confirmLocked}
          >
            {props.busy ? "Provádím..." : props.confirmLabel ?? "Potvrdit"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SidePanel(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!props.open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-sidepanel-backdrop" role="presentation" onClick={props.onClose}>
      <aside className="admin-sidepanel" aria-label={props.title} onClick={(event) => event.stopPropagation()}>
        <div className="admin-sidepanel-head">
          <div>
            <div className="admin-sidepanel-title">{props.title}</div>
            {props.subtitle ? <div className="admin-sidepanel-subtitle">{props.subtitle}</div> : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            Zavřít
          </Button>
        </div>
        <div className="admin-sidepanel-body">{props.children}</div>
        {props.footer ? <div className="admin-sidepanel-footer">{props.footer}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}

export function Toast(props: { message: string | null; tone?: "ok" | "danger" | "warning" }) {
  if (!props.message || typeof document === "undefined") return null;
  return createPortal(<div className={cx("admin-toast", props.tone && `admin-toast--${props.tone}`)}>{props.message}</div>, document.body);
}
