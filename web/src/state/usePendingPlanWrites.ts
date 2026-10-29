import { useCallback, useState } from "react";

export function usePendingPlanWrites() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const begin = useCallback((employmentId: unknown, date: unknown) => {
    const key = `${employmentId}:${date}`;
    setCounts((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  }, []);
  const finish = useCallback((employmentId: unknown, date: unknown) => {
    const key = `${employmentId}:${date}`;
    setCounts((current) => {
      const next = { ...current };
      if ((next[key] ?? 0) <= 1) delete next[key];
      else next[key] -= 1;
      return next;
    });
  }, []);
  const isPending = (employmentId: number, date: string) => (counts[`${employmentId}:${date}`] ?? 0) > 0;
  return { begin, finish, isPending };
}
