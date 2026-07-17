import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDateFormatter } from "../utils/format";
import { Button } from "./Primitives";

export function MonthControl({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const { t } = useTranslation();
  const formatter = useDateFormatter({ month: "long", year: "numeric" });
  const move = (amount: number) => onChange(new Date(value.getFullYear(), value.getMonth() + amount, 1));
  return <div className="month-control" aria-label={t("monthControl.label")}>
    <Button variant="quiet" aria-label={t("monthControl.previous")} onClick={() => move(-1)}><ChevronLeft /></Button>
    <strong>{formatter.format(value)}</strong>
    <Button variant="quiet" aria-label={t("monthControl.next")} onClick={() => move(1)}><ChevronRight /></Button>
  </div>;
}
