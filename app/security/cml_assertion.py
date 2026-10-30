"""CML signed web boundary. Browser content never establishes an identity."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ISSUER = "https://kajovocml.hcasc.cz"


class AssertionDenied(ValueError):
    pass


def _decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise AssertionDenied("invalid_encoding")
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


class WebVerifier:
    def __init__(self, audience: str, jwks: dict[str, Any]):
        self.audience = audience
        keys = jwks.get("keys", [])
        if len(keys) != 1:
            raise AssertionDenied("invalid_key_set")
        k = keys[0]
        if k.get("kty") != "OKP" or k.get("crv") != "Ed25519" or k.get("kid") != "cml-web-1" or "d" in k:
            raise AssertionDenied("invalid_key")
        self.key = Ed25519PublicKey.from_public_bytes(_decode(k["x"]))

    @classmethod
    def from_file(cls, audience: str, path: str) -> WebVerifier:
        return cls(audience, json.loads(Path(path).read_text(encoding="utf-8")))

    def verify(self, token: str, method: str, path: str, body: bytes, now: int | None = None) -> dict[str, Any]:
        try:
            if not isinstance(token, str) or len(token) > 8192:
                raise AssertionDenied("invalid_assertion")
            h, p, s = token.split(".")
            header, claims = json.loads(_decode(h)), json.loads(_decode(p))
            if header != {"typ": "cml-web+jwt", "alg": "EdDSA", "kid": "cml-web-1"}:
                raise AssertionDenied("invalid_header")
            self.key.verify(_decode(s), (h + "." + p).encode("ascii"))
            n = int(time.time()) if now is None else now
            if not isinstance(claims, dict):
                raise AssertionDenied("invalid_claims")
            iat, exp = claims.get("iat"), claims.get("exp")
            if (type(iat) is not int or type(exp) is not int or exp - iat != 10 or not n - 10 <= iat <= n + 1 or exp <= n):
                raise AssertionDenied("expired_assertion")
            if (claims.get("iss") != ISSUER or claims.get("aud") != self.audience or claims.get("method") != method or claims.get("path") != path or claims.get("bodySha256") != hashlib.sha256(body).hexdigest()):
                raise AssertionDenied("request_mismatch")
            if (not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", str(claims.get("jti", ""))) or not re.fullmatch(r"[0-9a-f-]{36}", str(claims.get("sid", ""))) or type(claims.get("epoch")) is not int or claims["epoch"] < 1):
                raise AssertionDenied("invalid_identity")
            subject = claims.get("sub", "")
            if subject != "KRMAR78" and not re.fullmatch(r"user:[0-9a-f-]{36}", str(subject)):
                raise AssertionDenied("invalid_subject")
            if claims.get("role") not in {"admin", "member"}:
                raise AssertionDenied("invalid_role")
            if subject != "KRMAR78" and (not isinstance(claims.get("nativeId"), str) or not re.fullmatch(r"[1-9][0-9]*", claims["nativeId"])):
                raise AssertionDenied("native_identity_required")
            if not isinstance(claims.get("csrf"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", claims["csrf"]):
                raise AssertionDenied("invalid_csrf")
            return claims
        except (ValueError, TypeError, KeyError, InvalidSignature) as exc:
            raise AssertionDenied("assertion_denied") from exc
