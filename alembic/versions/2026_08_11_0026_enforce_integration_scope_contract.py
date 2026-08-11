"""Backfill enforceable integration scopes and remove inert scope grants.

Revision ID: 2026_08_11_0026
Revises: 2026_08_11_0025
"""

from __future__ import annotations

import json

import sqlalchemy as sa

from alembic import op

revision = "2026_08_11_0026"
down_revision = "2026_08_11_0025"
branch_labels = None
depends_on = None

_VALID_MODES = {
    "ALL_EMPLOYMENTS",
    "ALL_ACTIVE_EMPLOYMENTS",
    "SELECTED_EMPLOYEES",
    "SELECTED_EMPLOYMENTS",
}
_INERT_SCOPES = {"shift_plan:read", "punches:read"}


def _json_list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return []
        return decoded if isinstance(decoded, list) else []
    return []


def _inferred_mode(row: sa.RowMapping) -> str:
    current = str(row["data_scope_mode"] or "").strip()
    if _json_list(row["allowed_employee_ids"]):
        return "SELECTED_EMPLOYEES"
    if _json_list(row["allowed_employment_ids"]):
        return "SELECTED_EMPLOYMENTS"
    if current in _VALID_MODES:
        return current
    return "ALL_EMPLOYMENTS"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("integration_clients")}
    required = {
        "id",
        "scopes",
        "allowed_employment_ids",
        "allowed_employee_ids",
        "data_scope_mode",
    }
    missing = required - columns
    if missing:
        raise RuntimeError(f"0026 precondition failed; integration_clients lacks {sorted(missing)}")

    rows = bind.execute(
        sa.text(
            "SELECT id, scopes, allowed_employment_ids, allowed_employee_ids, data_scope_mode "
            "FROM integration_clients ORDER BY id"
        )
    ).mappings()
    for row in rows:
        before_scopes = [str(item) for item in _json_list(row["scopes"])]
        after_scopes = [item for item in before_scopes if item not in _INERT_SCOPES]
        mode = _inferred_mode(row)
        update_client = sa.text(
            "UPDATE integration_clients "
            "SET data_scope_mode = :mode, scopes = :scopes, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = :client_id"
        ).bindparams(sa.bindparam("scopes", type_=sa.JSON()))
        bind.execute(
            update_client,
            {
                "client_id": int(row["id"]),
                "mode": mode,
                "scopes": after_scopes,
            },
        )
        before_mode = str(row["data_scope_mode"] or "").strip()
        if before_scopes != after_scopes or before_mode != mode:
            insert_audit = sa.text(
                "INSERT INTO integration_audit_log "
                "(client_id, request_id, method, path, status_code, operation, before_state, after_state) "
                "VALUES (:client_id, :request_id, 'MIGRATE', '/migration/0026', 200, "
                "'scope_normalize', :before_state, :after_state)"
            ).bindparams(
                sa.bindparam("before_state", type_=sa.JSON()),
                sa.bindparam("after_state", type_=sa.JSON()),
            )
            bind.execute(
                insert_audit,
                {
                    "client_id": int(row["id"]),
                    "request_id": f"migration-0026-{int(row['id'])}",
                    "before_state": {
                        "scopes": before_scopes,
                        "data_scope_mode": before_mode,
                    },
                    "after_state": {
                        "scopes": after_scopes,
                        "data_scope_mode": mode,
                    },
                },
            )

    invalid_modes = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM integration_clients "
            "WHERE data_scope_mode NOT IN "
            "('ALL_EMPLOYMENTS', 'ALL_ACTIVE_EMPLOYMENTS', "
            "'SELECTED_EMPLOYEES', 'SELECTED_EMPLOYMENTS')"
        )
    ).scalar_one()
    remaining_inert = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM integration_clients "
            "WHERE CAST(scopes AS TEXT) LIKE '%shift_plan:read%' "
            "OR CAST(scopes AS TEXT) LIKE '%punches:read%'"
        )
    ).scalar_one()
    if int(invalid_modes) or int(remaining_inert):
        raise RuntimeError(
            "0026 postcondition failed; integration scope normalization is incomplete"
        )


def downgrade() -> None:
    # Data-only security normalization is intentionally not reversed.
    return
