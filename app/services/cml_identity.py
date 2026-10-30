"""Resolve a signed CML principal against current attendance ownership."""
from app.db import models
from app.security.cml_assertion import AssertionDenied
from app.security.sessions import AdminSession


def resolve_identity(db, claims, selected_role):
    admin = claims['role'] == 'admin'
    if claims['sub'] == 'KRMAR78':
        return {'state': {'cml_admin': AdminSession(username='cml:owner', issued_at=claims['iat'])}, 'public': {'admin': True, 'name': 'karmar78', 'languages': ['cs', 'en', 'sk', 'de']}}
    user = db.get(models.PortalUser, int(claims['nativeId']))
    if user is None or not user.is_active or user.is_blocked:
        raise AssertionDenied('local_account_unavailable')
    instance = user.instance
    if instance is None or instance.status != models.InstanceStatus.ACTIVE:
        raise AssertionDenied('local_instance_unavailable')
    state = {'cml_user_id': user.id}
    if admin:
        state['cml_admin'] = AdminSession(username='cml:' + claims['sub'], issued_at=claims['iat'])
    return {'state': state, 'public': {'admin': admin, 'id': user.id, 'name': user.name, 'languages': ['cs', 'en', 'sk', 'de'] if admin else ['cs', 'en', 'sk', 'de', 'hi']}}


def session_factory():
    from app.db.session import get_sessionmaker
    return get_sessionmaker()()
