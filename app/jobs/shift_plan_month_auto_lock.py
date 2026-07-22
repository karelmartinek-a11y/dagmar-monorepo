from __future__ import annotations

import logging

from app.db.session import get_sessionmaker
from app.services.shift_plan_auto_lock import auto_lock_current_shift_plan_month


def main() -> int:
    sessionmaker = get_sessionmaker()
    with sessionmaker() as db:
        result = auto_lock_current_shift_plan_month(db)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.info(
        "Shift plan auto-lock finished for %04d-%02d (already_processed=%s, locked_count=%d)",
        result.year,
        result.month,
        result.already_processed,
        result.locked_count,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
