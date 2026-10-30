"""ASGI entrypoint for independently deployed CML web sections."""
from __future__ import annotations

import asyncio
import hmac
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import parse_qs

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.responses import FileResponse, JSONResponse

from app.security.cml_assertion import AssertionDenied, WebVerifier


class CmlWebBoundary:
    def __init__(self, app, *, audience, session_factory, resolve_identity, ui_root):
        self.app = app
        self.audience = audience
        self.session_factory = session_factory
        self.resolve_identity = resolve_identity
        self.ui_root = Path(ui_root).resolve()
        path = os.getenv('CML_WEB_JWKS_PATH')
        self.verifier = WebVerifier.from_file(audience, path) if path else None

    def _identity(self, claims, selected_role):
        with self.session_factory() as db:
            try:
                db.execute(text('DELETE FROM cml_web_nonce WHERE expires_at < :now'), {'now': claims['iat'] - 20})
                db.execute(text('INSERT INTO cml_web_nonce(jti,expires_at) VALUES(:jti,:exp)'), claims)
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise AssertionDenied('assertion_replayed') from exc
            return self.resolve_identity(db, claims, selected_role)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/cml-web/'):
            await self.app(scope, receive, send)
            return
        if self.verifier is None:
            await JSONResponse({'error': 'cml_web_unconfigured'}, status_code=503)(scope, receive, send)
            return
        try:
            headers = {k.decode('latin1').lower(): v.decode('latin1') for k, v in scope['headers']}
            if headers.get('origin') != 'https://kajovocml.hcasc.cz':
                raise AssertionDenied('issuer_required')
            body = bytearray()
            while True:
                message = await receive()
                if message['type'] != 'http.request':
                    raise AssertionDenied('incomplete_request')
                body.extend(message.get('body', b''))
                if len(body) > 8_000_000:
                    raise AssertionDenied('payload_too_large')
                if not message.get('more_body'):
                    break
            raw_path = scope.get('raw_path', scope['path'].encode()).decode('ascii')
            query = scope.get('query_string', b'').decode('ascii')
            exact_path = raw_path + ('?' + query if query else '')
            claims = self.verifier.verify(headers.get('x-cml-web-assertion', ''), scope['method'], exact_path, bytes(body))
            expected_prefix = '/sections/' + self.audience + '/'
            if headers.get('x-cml-web-prefix') != expected_prefix:
                raise AssertionDenied('prefix_mismatch')
            if scope['method'] not in {'GET', 'HEAD'} and not hmac.compare_digest(headers.get('x-csrf-token', ''), claims['csrf']):
                raise AssertionDenied('csrf_denied')
            identity = await asyncio.to_thread(self._identity, claims, parse_qs(query).get('_role', [None])[0])
            suffix = scope['path'][len('/cml-web/'):]
            if any(v in raw_path.lower() for v in ('%2e', '%2f', '%5c', '%25')) or '..' in suffix.split('/') or '\\' in suffix:
                raise AssertionDenied('path_denied')
            if suffix == 'identity':
                await JSONResponse(identity['public'], headers={'Cache-Control': 'no-store'})(scope, receive, send)
                return
            if suffix == 'ui-manifest.json':
                manifest = json.loads((self.ui_root / 'ui-manifest.json').read_text(encoding='utf-8'))
                manifest['views'] = [v for v in manifest['views'] if (not v.get('admin') or identity['public']['admin']) and (v.get('audienceRole') is None or v['audienceRole']==('admin' if identity['public']['admin'] else 'member')) and (not v.get('permission') or v['permission'] in identity['public'].get('permissions', []))]
                await JSONResponse(manifest, headers={'Cache-Control': 'no-store'})(scope, receive, send)
                return
            if not suffix.startswith('api/'):
                path = self.ui_root / (suffix or 'index.html')
                if path.resolve().is_relative_to(self.ui_root) and path.is_file() and path.suffix in {'.html', '.js', '.css', '.svg', '.ttf'}:
                    response = FileResponse(path, media_type=mimetypes.guess_type(path)[0], headers={'Cache-Control': 'no-store'})
                    await response(scope, receive, send)
                else:
                    await JSONResponse({'error': 'not_found'}, status_code=404)(scope, receive, send)
                return
            # A signed request cannot start a local login or invoke a different public protocol.
            if not suffix.startswith(('api/v1/', 'api/auth/')) or suffix.endswith(('/login', '/logout', '/reset-password', '/request-password-reset')):
                raise AssertionDenied('route_denied')
            forwarded = dict(scope)
            forwarded['path'] = '/' + suffix
            forwarded['raw_path'] = ('/' + suffix).encode()
            forwarded['state'] = {**scope.get('state', {}), **identity.get('state', {}), 'cml_web_claims': claims}
            consumed = False

            async def replay_body():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                return await receive()

            await self.app(forwarded, replay_body, send)
        except (AssertionDenied, UnicodeError):
            await JSONResponse({'error': 'cml_web_denied'}, status_code=401, headers={'Cache-Control': 'no-store'})(scope, receive, send)
