# ruff: noqa: B008
from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.db.models import EmploymentGroup
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.employment_access import employment_label
from app.services.employment_groups import (
    EmploymentGroupError,
    create_group,
    get_group,
    list_groups,
    remove_members,
    rename_group,
    replace_members,
)

router = APIRouter(tags=["admin-employment-groups"])


class EmploymentGroupMemberOut(BaseModel):
    employment_id: int
    user_name: str
    title: str
    employment_type: str
    display_label: str
    start_date: str
    end_date: str | None = None


class EmploymentGroupOut(BaseModel):
    id: int
    name: str
    members: list[EmploymentGroupMemberOut]


class EmploymentGroupListOut(BaseModel):
    groups: list[EmploymentGroupOut]


class EmploymentGroupCreateIn(BaseModel):
    name: str = Field(max_length=160)
    employment_ids: list[int] = Field(min_length=2)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return " ".join(value.split())


class EmploymentGroupNameIn(BaseModel):
    name: str = Field(max_length=160)


class EmploymentGroupMembersIn(BaseModel):
    employment_ids: list[int] = Field(min_length=1)


class EmploymentGroupDeleteOut(BaseModel):
    ok: bool = True
    group_deleted: bool = False


def _error(error: EmploymentGroupError) -> NoReturn:
    code_to_status = {
        "group_not_found": status.HTTP_404_NOT_FOUND,
        "employment_not_found": status.HTTP_404_NOT_FOUND,
        "group_member_not_found": status.HTTP_404_NOT_FOUND,
        "duplicate_group_name": status.HTTP_409_CONFLICT,
        "duplicate_group_member": status.HTTP_409_CONFLICT,
        "invalid_group_name": status.HTTP_400_BAD_REQUEST,
        "group_requires_two_members": status.HTTP_400_BAD_REQUEST,
    }
    raise_api_error(
        code_to_status.get(error.code, status.HTTP_400_BAD_REQUEST), error.code, str(error)
    )


def _to_out(group: EmploymentGroup) -> EmploymentGroupOut:
    members = sorted(group.members, key=lambda member: member.employment_id)
    return EmploymentGroupOut(
        id=group.id,
        name=group.name,
        members=[
            EmploymentGroupMemberOut(
                employment_id=member.employment_id,
                user_name=member.employment.user.name,
                title=member.employment.title,
                employment_type=member.employment.employment_type,
                display_label=employment_label(member.employment, member.employment.user.name),
                start_date=member.employment.start_date.isoformat(),
                end_date=member.employment.end_date.isoformat()
                if member.employment.end_date
                else None,
            )
            for member in members
        ],
    )


@router.get("/api/v1/admin/employment-groups", response_model=EmploymentGroupListOut)
def admin_list_employment_groups(
    _admin=Depends(require_admin), db: Session = Depends(get_db)
) -> EmploymentGroupListOut:
    return EmploymentGroupListOut(groups=[_to_out(group) for group in list_groups(db)])


@router.post(
    "/api/v1/admin/employment-groups",
    response_model=EmploymentGroupOut,
    status_code=status.HTTP_201_CREATED,
)
def admin_create_employment_group(
    body: EmploymentGroupCreateIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> EmploymentGroupOut:
    try:
        group = create_group(db, name=body.name, member_ids=body.employment_ids)
        db.commit()
    except EmploymentGroupError as error:
        db.rollback()
        _error(error)
    except IntegrityError:
        db.rollback()
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "duplicate_group_member",
            "Skupinu nelze uložit kvůli souběžné změně členství.",
        )
    return _to_out(group)


@router.put("/api/v1/admin/employment-groups/{group_id}", response_model=EmploymentGroupOut)
def admin_update_employment_group(
    group_id: int,
    body: EmploymentGroupNameIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> EmploymentGroupOut:
    try:
        group = rename_group(db, group_id=group_id, name=body.name)
        db.commit()
    except EmploymentGroupError as error:
        db.rollback()
        _error(error)
    if group is None:
        raise_api_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "data_integrity_error",
            "Skupinu se nepodařilo po změně načíst.",
        )
    return _to_out(group)


@router.put("/api/v1/admin/employment-groups/{group_id}/members", response_model=EmploymentGroupOut)
def admin_replace_employment_group_members(
    group_id: int,
    body: EmploymentGroupMembersIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> EmploymentGroupOut:
    try:
        group = replace_members(db, group_id=group_id, member_ids=body.employment_ids)
        db.commit()
    except EmploymentGroupError as error:
        db.rollback()
        _error(error)
    if group is None:
        raise_api_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "data_integrity_error",
            "Skupinu se nepodařilo po změně načíst.",
        )
    return _to_out(group)


@router.delete(
    "/api/v1/admin/employment-groups/{group_id}/members", response_model=EmploymentGroupDeleteOut
)
def admin_remove_employment_group_members(
    group_id: int,
    body: EmploymentGroupMembersIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> EmploymentGroupDeleteOut:
    try:
        group_deleted = remove_members(db, group_id=group_id, member_ids=body.employment_ids)
        db.commit()
    except EmploymentGroupError as error:
        db.rollback()
        _error(error)
    return EmploymentGroupDeleteOut(group_deleted=group_deleted)


@router.delete(
    "/api/v1/admin/employment-groups/{group_id}", response_model=EmploymentGroupDeleteOut
)
def admin_delete_employment_group(
    group_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> EmploymentGroupDeleteOut:
    group = get_group(db, group_id, lock=True)
    if group is None:
        raise_api_error(status.HTTP_404_NOT_FOUND, "group_not_found", "Skupina nebyla nalezena.")
    db.delete(group)
    db.commit()
    return EmploymentGroupDeleteOut(group_deleted=True)
