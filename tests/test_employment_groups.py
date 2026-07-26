from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Base, Employment, PortalUser, PortalUserRole
from app.services.employment_groups import (
    EmploymentGroupError,
    create_group,
    list_groups,
    remove_groups_for_employment,
    remove_members,
)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        users = [PortalUser(email=f"user{index}@example.test", name=f"User {index}", role=PortalUserRole.EMPLOYEE) for index in range(3)]
        session.add_all(users)
        session.flush()
        session.add_all(
            Employment(user_id=user.id, title="Služba", employment_type="HPP", start_date=date(2026, 1, 1))
            for user in users
        )
        session.commit()
        yield session


def _employment_ids(db: Session) -> list[int]:
    return [employment.id for employment in db.query(Employment).order_by(Employment.id).all()]


def test_group_requires_two_distinct_existing_employments(db: Session) -> None:
    ids = _employment_ids(db)
    with pytest.raises(EmploymentGroupError, match="alespoň dva"):
        create_group(db, name="Ranní", member_ids=[ids[0]])
    with pytest.raises(EmploymentGroupError, match="vícekrát"):
        create_group(db, name="Ranní", member_ids=[ids[0], ids[0]])
    with pytest.raises(EmploymentGroupError, match="nebylo nalezeno"):
        create_group(db, name="Ranní", member_ids=[ids[0], 9999])


def test_group_normalizes_name_and_allows_member_in_multiple_groups(db: Session) -> None:
    first, second, third = _employment_ids(db)
    create_group(db, name="  Ranní   směna ", member_ids=[first, second])
    create_group(db, name="Odpolední", member_ids=[first, third])
    db.commit()
    groups = list_groups(db)
    assert {group.name for group in groups} == {"Ranní směna", "Odpolední"}
    with pytest.raises(EmploymentGroupError) as error:
        create_group(db, name="rAnNí SmĚnA", member_ids=[second, third])
    assert error.value.code == "duplicate_group_name"


def test_removing_member_from_two_member_group_removes_group(db: Session) -> None:
    first, second, _ = _employment_ids(db)
    group = create_group(db, name="Ranní", member_ids=[first, second])
    db.commit()
    assert remove_members(db, group_id=group.id, member_ids=[first]) is True
    db.commit()
    assert list_groups(db) == []


def test_removing_employment_keeps_minimum_member_invariant(db: Session) -> None:
    first, second, third = _employment_ids(db)
    create_group(db, name="Tři", member_ids=[first, second, third])
    create_group(db, name="Dva", member_ids=[first, second])
    db.commit()
    remove_groups_for_employment(db, first)
    db.commit()
    groups = list_groups(db)
    assert len(groups) == 1
    assert {member.employment_id for member in groups[0].members} == {second, third}
