"""Group memberships exposed to the same administrators who manage the CML view."""

import hashlib
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.errors import raise_api_error
from app.api.v1 import admin_employment_groups as admin
from app.db.models import EmploymentGroup
from app.security.sessions import AdminSession
from app.services.employment_groups import get_group


class GroupDetail(BaseModel):
    group_id: int
    name: str
    employment_ids: list[int]
    membership_version: str
    next_after: int | None = None


def _load(db: Session, group_id: int, *, lock: bool = False) -> EmploymentGroup:
    group = get_group(db, group_id, lock=lock)
    if group is None:
        raise_api_error(404, "group_not_found", "Skupina nebyla nalezena.")
    return group


def _member_ids(group: EmploymentGroup) -> list[int]:
    return sorted(member.employment_id for member in group.members)


def _membership_version(group: EmploymentGroup, ids: list[int]) -> str:
    identifier = f"{group.id}:" + ",".join(map(str, ids))
    return hashlib.sha256(identifier.encode()).hexdigest()


def group_details(db: Session, group_id: int, after: int, limit: int) -> GroupDetail:
    group = _load(db, group_id)
    ids = _member_ids(group)
    page = [value for value in ids if value > after]
    return GroupDetail(
        group_id=group.id,
        name=group.name,
        employment_ids=page[:limit],
        membership_version=_membership_version(group, ids),
        next_after=page[limit - 1] if len(page) > limit else None,
    )


def create(db: Session, subject: str, name: str, employment_ids: list[int]) -> None:
    admin.admin_create_employment_group(
        admin.EmploymentGroupCreateIn(name=name, employment_ids=employment_ids),
        _admin=AdminSession(subject, 0),
        _=None,
        db=db,
    )


def rename(db: Session, subject: str, group_id: int, name: str, expected_name: str) -> None:
    group = _load(db, group_id, lock=True)
    if group.name != expected_name:
        raise_api_error(409, "group_changed", "Název se změnil. Znovu načti skupinu.")
    admin.admin_update_employment_group(
        group_id,
        admin.EmploymentGroupNameIn(name=name),
        _admin=AdminSession(subject, 0),
        _=None,
        db=db,
    )


def edit_members(
    db: Session,
    subject: str,
    group_id: int,
    action: Literal["replace", "remove", "delete"],
    expected_membership_version: str,
    employment_ids: list[int],
) -> None:
    group = _load(db, group_id, lock=True)
    if expected_membership_version != _membership_version(group, _member_ids(group)):
        raise_api_error(409, "group_changed", "Složení se změnilo. Znovu načti skupinu.")
    authorized = AdminSession(subject, 0)
    if action == "delete":
        admin.admin_delete_employment_group(group_id, _admin=authorized, _=None, db=db)
    elif action == "remove":
        admin.admin_remove_employment_group_members(
            group_id,
            admin.EmploymentGroupMembersIn(employment_ids=employment_ids),
            _admin=authorized,
            _=None,
            db=db,
        )
    else:
        admin.admin_replace_employment_group_members(
            group_id,
            admin.EmploymentGroupMembersIn(employment_ids=employment_ids),
            _admin=authorized,
            _=None,
            db=db,
        )
