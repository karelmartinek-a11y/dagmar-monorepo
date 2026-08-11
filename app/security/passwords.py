from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_password_hasher = PasswordHasher()


@dataclass(frozen=True)
class PasswordHash:
    value: str


@dataclass(frozen=True)
class PasswordVerification:
    valid: bool
    needs_rehash: bool = False


_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


def hash_password(password: str) -> PasswordHash:
    if not isinstance(password, str) or not password:
        raise ValueError("password must be a non-empty string")
    if len(password) > 512:
        raise ValueError("password too long")
    return PasswordHash(_password_hasher.hash(password))


def _is_plain_sha256_hash(password_hash: str) -> bool:
    return bool(_SHA256_HEX_RE.fullmatch(password_hash))


def verify_password_details(password: str, password_hash: str) -> PasswordVerification:
    if not password_hash:
        return PasswordVerification(valid=False)
    if _is_plain_sha256_hash(password_hash):
        computed_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return PasswordVerification(
            valid=constant_time_equals(computed_hash, password_hash),
            needs_rehash=True,
        )
    if password_hash.startswith("$argon2"):
        try:
            valid = bool(_password_hasher.verify(password_hash, password))
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return PasswordVerification(valid=False)
        return PasswordVerification(
            valid=valid,
            needs_rehash=valid and _password_hasher.check_needs_rehash(password_hash),
        )
    if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            valid = bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
        except (ValueError, UnicodeError):
            return PasswordVerification(valid=False)
        return PasswordVerification(valid=valid, needs_rehash=valid)
    return PasswordVerification(valid=False)


def verify_password(password: str, password_hash: str) -> bool:
    return verify_password_details(password, password_hash).valid


def is_password_hash_outdated(password_hash: str) -> bool:
    if not password_hash:
        return False
    if _is_plain_sha256_hash(password_hash):
        return True
    if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        return True
    if password_hash.startswith("$argon2"):
        try:
            return _password_hasher.check_needs_rehash(password_hash)
        except InvalidHashError:
            return False
    return False


def constant_time_equals(a: str, b: str) -> bool:
    # Defensive helper for the retained SHA-256 migration path.
    a_b = a.encode("utf-8")
    b_b = b.encode("utf-8")
    return hmac.compare_digest(a_b, b_b)
