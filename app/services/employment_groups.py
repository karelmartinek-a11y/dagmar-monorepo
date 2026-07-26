from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Employment, EmploymentGroup, EmploymentGroupMember


class EmploymentGroupError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def normalize_group_name(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise EmploymentGroupError("invalid_group_name", "Název skupiny je povinný.")
    return normalized


def normalize_member_ids(values: Iterable[int]) -> list[int]:
    member_ids = list(values)
    if len(member_ids) < 2:
        raise EmploymentGroupError("group_requires_two_members", "Skupina musí obsahovat alespoň dva různé úvazky.")
    if len(set(member_ids)) != len(member_ids):
        raise EmploymentGroupError("duplicate_group_member", "Stejný úvazek nelze do skupiny přidat vícekrát.")
    return member_ids


def _load_employments(db: Session, member_ids: list[int]) -> list[Employment]:
    employments = db.execute(select(Employment).where(Employment.id.in_(member_ids))).scalars().all()
    if len(employments) != len(member_ids):
        raise EmploymentGroupError("employment_not_found", "Jeden nebo více úvazků nebylo nalezeno.")
    return employments


def get_group(db: Session, group_id: int, *, lock: bool = False) -> EmploymentGroup | None:
    query = select(EmploymentGroup).options(selectinload(EmploymentGroup.members).selectinload(EmploymentGroupMember.employment).selectinload(Employment.user)).where(EmploymentGroup.id == group_id)
    if lock:
        query = query.with_for_update()
    return db.execute(query).scalars().first()


def list_groups(db: Session) -> list[EmploymentGroup]:
    return db.execute(
        select(EmploymentGroup)
        .options(selectinload(EmploymentGroup.members).selectinload(EmploymentGroupMember.employment).selectinload(Employment.user))
        .order_by(EmploymentGroup.name.asc(), EmploymentGroup.id.asc())
    ).scalars().all()


def _ensure_unique_name(db: Session, name: str, *, excluding_id: int | None = None) -> None:
    query = select(EmploymentGroup.id).where(func.lower(EmploymentGroup.name) == name.lower())
    if excluding_id is not None:
        query = query.where(EmploymentGroup.id != excluding_id)
    if db.execute(query).first() is not None:
        raise EmploymentGroupError("duplicate_group_name", "Skupina s tímto názvem již existuje.")


def create_group(db: Session, *, name: str, member_ids: Iterable[int]) -> EmploymentGroup:
    name = normalize_group_name(name)
    ids = normalize_member_ids(member_ids)
    _ensure_unique_name(db, name)
    _load_employments(db, ids)
    group = EmploymentGroup(name=name)
    db.add(group)
    db.flush()
    db.add_all(EmploymentGroupMember(group_id=group.id, employment_id=employment_id) for employment_id in ids)
    db.flush()
    return get_group(db, group.id) or group


def replace_members(db: Session, *, group_id: int, member_ids: Iterable[int]) -> EmploymentGroup | None:
    ids = normalize_member_ids(member_ids)
    group = get_group(db, group_id, lock=True)
    if group is None:
        raise EmploymentGroupError("group_not_found", "Skupina nebyla nalezena.")
    _load_employments(db, ids)
    db.query(EmploymentGroupMember).filter(EmploymentGroupMember.group_id == group.id).delete(synchronize_session=False)
    db.add_all(EmploymentGroupMember(group_id=group.id, employment_id=employment_id) for employment_id in ids)
    db.flush()
    return get_group(db, group.id)


def rename_group(db: Session, *, group_id: int, name: str) -> EmploymentGroup:
    group = get_group(db, group_id, lock=True)
    if group is None:
        raise EmploymentGroupError("group_not_found", "Skupina nebyla nalezena.")
    normalized = normalize_group_name(name)
    _ensure_unique_name(db, normalized, excluding_id=group.id)
    group.name = normalized
    db.flush()
    return get_group(db, group.id) or group


def remove_members(db: Session, *, group_id: int, member_ids: Iterable[int]) -> bool:
    ids = list(member_ids)
    group = get_group(db, group_id, lock=True)
    if group is None:
        raise EmploymentGroupError("group_not_found", "Skupina nebyla nalezena.")
    current = {member.employment_id for member in group.members}
    if not set(ids).issubset(current):
        raise EmploymentGroupError("group_member_not_found", "Úvazek není členem této skupiny.")
    group.members = [member for member in group.members if member.employment_id not in set(ids)]
    db.flush()
    remaining = len(group.members)
    if remaining < 2:
        db.delete(group)
        db.flush()
        return True
    db.flush()
    return False


def remove_groups_for_employment(db: Session, employment_id: int) -> None:
    """Remove membership and atomically drop every group made invalid by employment deletion."""
    group_ids = [row[0] for row in db.execute(select(EmploymentGroupMember.group_id).where(EmploymentGroupMember.employment_id == employment_id)).all()]
    for group_id in group_ids:
        remove_members(db, group_id=group_id, member_ids=[employment_id])
