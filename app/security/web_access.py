"""Closed CML attendance permissions with explicit employment ownership."""

import re

from app.security.cml_assertion import AssertionDenied


def attendance_access(claims):
    grant = claims.get("grant")
    if not isinstance(grant, dict) or set(grant) != {"contract", "permissions", "dataScope"}:
        raise AssertionDenied("attendance_grant_required")
    scope = grant.get("dataScope")
    if (
        claims.get("role") != "member"
        or claims.get("authzPolicy") is not None
        or grant["contract"] != "kajovo-web-grant/1"
        or grant["permissions"] not in (["attendance.self"], ["attendance.manage"])
        or not isinstance(scope, dict)
        or set(scope) != {"kind", "employmentIds"}
        or scope["kind"] != "employments"
    ):
        raise AssertionDenied("attendance_grant_invalid")
    ids = scope["employmentIds"]
    if (
        not isinstance(ids, list)
        or len(ids) > 100
        or any(
            not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]*", value) for value in ids
        )
        or len(set(ids)) != len(ids)
    ):
        raise AssertionDenied("attendance_employments_invalid")
    admin = grant["permissions"] == ["attendance.manage"]
    if not admin and not ids:
        raise AssertionDenied("attendance_employment_required")
    return admin, frozenset(map(int, ids))
