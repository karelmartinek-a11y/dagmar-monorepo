import { useEffect, useRef, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, WifiOff } from "lucide-react";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function Panel({ children, className = "", title, actions }: PropsWithChildren<{ className?: string; title?: string; actions?: ReactNode }>) {
  return <section className={`panel ${className}`}>
    {(title || actions) && <header className="panel__header"><h2>{title}</h2>{actions}</header>}
    {children}
  </section>;
}

export function StatusMessage({ kind, title, children }: PropsWithChildren<{ kind: "loading" | "error" | "empty" | "success" | "offline"; title: string }>) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "success" ? CheckCircle2 : kind === "offline" ? WifiOff : AlertTriangle;
  return <div className={`state state--${kind}`} role={kind === "error" ? "alert" : "status"}>
    <Icon aria-hidden="true" className={kind === "loading" ? "spin" : ""} />
    <div><strong>{title}</strong>{children && <p>{children}</p>}</div>
  </div>;
}

export function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Modal({ title, description, confirmLabel, danger, onConfirm, onClose }: {
  title: string; description: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const dialogRef=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=dialogRef.current;if(!dialog)return;const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(item=>!item.hasAttribute("disabled"));focusable()[0]?.focus();const keydown=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();onClose();return}if(event.key!=="Tab")return;const items=focusable();if(items.length===0)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener("keydown",keydown);return()=>{document.removeEventListener("keydown",keydown);previous?.focus()}},[onClose]);
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
      <span className="modal__signal" aria-hidden="true"><AlertTriangle /></span>
      <h2 id="modal-title">{title}</h2><div id="modal-description">{description}</div>
      <footer><Button variant="quiet" onClick={onClose}>Zrušit</Button><Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button></footer>
    </section>
  </div>;
}
