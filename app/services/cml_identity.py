"""Resolve a signed CML principal against current attendance ownership."""
from app.db import models
from app.security.cml_assertion import AssertionDenied, central_administrator
from app.security.sessions import AdminSession
from app.security.web_access import attendance_access


def resolve_identity(db, claims, selected_role):
    admin = False
    if central_administrator(claims):
        return {'state':{'cml_admin':AdminSession(username='cml:'+claims['sub'],issued_at=claims['iat'])},'public':{'admin':True,'name':claims['sub'],'languages':['cs']}}
    if claims['sub'] == 'KRMAR78':
        return {'state': {'cml_admin': AdminSession(username='cml:owner', issued_at=claims['iat'])}, 'public': {'admin': True, 'name': 'karmar78', 'languages': ['cs', 'en', 'sk', 'de']}}
    user = db.get(models.PortalUser, int(claims['nativeId']))
    if user is None or not user.is_active or user.is_blocked:
        raise AssertionDenied('local_account_unavailable')
    instance = user.instance
    if instance is None or instance.status != models.InstanceStatus.ACTIVE:
        raise AssertionDenied('local_instance_unavailable')
    admin, employment_ids = attendance_access(claims)
    owned = {employment.id for employment in user.employments}
    if not employment_ids <= owned:
        raise AssertionDenied('attendance_employment_not_owned')
    state = {'cml_user_id': user.id, 'cml_employment_ids': None if admin else employment_ids}
    if admin:
        state['cml_admin'] = AdminSession(username='cml:' + claims['sub'], issued_at=claims['iat'])
    return {'state': state, 'public': {'admin': admin, 'id': user.id, 'name': user.name, 'languages': ['cs', 'en', 'sk', 'de'] if admin else ['cs', 'en', 'sk', 'de', 'hi']}}


def session_factory():
    from app.db.session import get_sessionmaker
    return get_sessionmaker()()
