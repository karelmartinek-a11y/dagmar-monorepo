from sqlalchemy import Enum

from app.db.models import PortalUser


def test_portal_user_role_uses_database_enum_values() -> None:
    column_type = PortalUser.__table__.c.role.type

    assert isinstance(column_type, Enum)
    assert column_type.enums == ["employee"]
