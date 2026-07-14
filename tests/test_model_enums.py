from sqlalchemy import Enum

from app.db.models import PortalUser


def test_portal_user_role_uses_production_database_enum_names() -> None:
    column_type = PortalUser.__table__.c.role.type

    assert isinstance(column_type, Enum)
    assert column_type.enums == ["EMPLOYEE"]
