import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Primitives";

const formatter = new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric", timeZone: "Europe/Prague" });
export function MonthControl({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const move = (amount: number) => onChange(new Date(value.getFullYear(), value.getMonth() + amount, 1));
  return <div className="month-control" aria-label="Volba měsíce">
    <Button variant="quiet" aria-label="Předchozí měsíc" onClick={() => move(-1)}><ChevronLeft /></Button>
    <strong>{formatter.format(value)}</strong>
    <Button variant="quiet" aria-label="Následující měsíc" onClick={() => move(1)}><ChevronRight /></Button>
  </div>;
}
