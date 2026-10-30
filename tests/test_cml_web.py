"""Isolated CML boundary tests; no live accounts, providers or network."""
import base64
import hashlib
import json
import time
import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.security.cml_assertion import AssertionDenied, WebVerifier
from app.security.cml_web import CmlWebBoundary


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def fixture_key():
    key = Ed25519PrivateKey.generate()
    from cryptography.hazmat.primitives import serialization
    x = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, {'keys': [{'kty': 'OKP', 'crv': 'Ed25519', 'kid': 'cml-web-1', 'x': b64(x)}]}


def assertion(key, audience, path='/cml-web/api/v1/echo?x=1', method='POST', body=b'{"safe":true}', **patch):
    now = int(time.time())
    claims = dict(iss='https://kajovocml.hcasc.cz', aud=audience, sub='KRMAR78', role='admin', nativeId=None, sid=str(uuid.uuid4()), epoch=1, iat=now, exp=now+10, jti=str(uuid.uuid4()), method=method, path=path, bodySha256=hashlib.sha256(body).hexdigest(), csrf='a'*43)
    claims.update(patch)
    h = b64(json.dumps({'typ': 'cml-web+jwt', 'alg': 'EdDSA', 'kid': 'cml-web-1'}, separators=(',', ':')).encode())
    p = b64(json.dumps(claims, separators=(',', ':')).encode())
    raw = h+'.'+p
    return raw+'.'+b64(key.sign(raw.encode()))


def test_signature_binds_request_lifetime_identity_and_audience():
    key, jwks = fixture_key()
    verifier = WebVerifier('section', jwks)
    token = assertion(key, 'section')
    assert verifier.verify(token, 'POST', '/cml-web/api/v1/echo?x=1', b'{"safe":true}')['role'] == 'admin'
    for method, path, body in [('GET','/cml-web/api/v1/echo?x=1',b'{"safe":true}'),('POST','/cml-web/api/v1/echo?x=2',b'{"safe":true}'),('POST','/cml-web/api/v1/echo?x=1',b'{"safe":false}')]:
        with pytest.raises(AssertionDenied):
            verifier.verify(token, method, path, body)
    for patch in [{'aud':'foreign'}, {'iss':'https://evil.invalid'}, {'role':'owner'}, {'epoch':False}, {'sub':'forged'}, {'sub':'user:'+str(uuid.uuid4()),'nativeId':None}, {'iat':int(time.time())-15,'exp':int(time.time())-5}]:
        with pytest.raises(AssertionDenied):
            verifier.verify(assertion(key,'section',**patch),'POST','/cml-web/api/v1/echo?x=1',b'{"safe":true}')
    foreign, _ = fixture_key()
    with pytest.raises(AssertionDenied):
        verifier.verify(assertion(foreign,'section'),'POST','/cml-web/api/v1/echo?x=1',b'{"safe":true}')


def test_boundary_replay_is_durable_and_cannot_create_local_login(tmp_path, monkeypatch):
    key, jwks = fixture_key()
    keyfile = tmp_path/'public.json'
    keyfile.write_text(json.dumps(jwks))
    monkeypatch.setenv('CML_WEB_JWKS_PATH',str(keyfile))
    engine = create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    factory = sessionmaker(bind=engine)
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE cml_web_nonce(jti text PRIMARY KEY,expires_at bigint NOT NULL)'))
    ui = tmp_path/'ui'
    ui.mkdir()
    (ui/'index.html').write_text('<html><head></head><body>new ui</body></html>')
    (ui/'ui-manifest.json').write_text(json.dumps({'contract':'kajovo-web-ui/1','views':[]}))
    app = FastAPI()
    @app.post('/api/v1/echo')
    async def echo(request: Request):
        return {'body':await request.json(),'principal':request.state.cml_web_claims['sub'],'native':request.state.native}
    def resolve(db, claims, selected):
        return {'state':{'native':'verified'},'public':{'admin':True}}

    app.add_middleware(CmlWebBoundary,audience='section',session_factory=factory,resolve_identity=resolve,ui_root=ui)
    client = TestClient(app)
    token = assertion(key,'section')
    headers={'Origin':'https://kajovocml.hcasc.cz','X-CML-Web-Assertion':token,'X-CML-Web-Prefix':'/sections/section/','X-CSRF-Token':'a'*43,'Content-Type':'application/json'}
    path='/cml-web/api/v1/echo?x=1'
    first=client.post(path,headers=headers,content=b'{"safe":true}')
    assert first.status_code==200
    assert first.json()=={'body':{'safe':True},'principal':'KRMAR78','native':'verified'}
    assert client.post(path,headers=headers,content=b'{"safe":true}').status_code==401
    client.close()
    # New middleware instance shares the durable nonce table.
    second=TestClient(CmlWebBoundary(FastAPI(),audience='section',session_factory=factory,resolve_identity=resolve,ui_root=ui))
    assert second.post(path,headers=headers,content=b'{"safe":true}').status_code==401
    token=assertion(key,'section')
    assert second.post(path,headers={**headers,'X-CML-Web-Assertion':token,'X-CSRF-Token':'wrong'},content=b'{"safe":true}').status_code==401
    login='/cml-web/api/auth/login'
    assert second.post(login,headers={**headers,'X-CML-Web-Assertion':assertion(key,'section',path=login)},content=b'{"safe":true}').status_code==401
    assert second.get('/cml-web/').status_code==401
    second.close()
    engine.dispose()


@pytest.mark.parametrize("audience,route", [("hotel","api/v1/users/1"),("dochazka","api/v1/admin/users/1")])
def test_central_account_routes_require_owner_fresh_reauth_and_keep_credentials_central(tmp_path, monkeypatch, audience, route):
    key, jwks = fixture_key()
    path = tmp_path/'public.json'
    path.write_text(json.dumps(jwks))
    monkeypatch.setenv('CML_WEB_JWKS_PATH',str(path))
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    factory=sessionmaker(bind=engine)
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE cml_web_nonce(jti text PRIMARY KEY,expires_at bigint NOT NULL)'))
    app=FastAPI()
    calls=[]
    @app.api_route('/'+route,methods=['GET','PATCH'])
    async def central(request:Request):
        calls.append(request.method)
        return {'accepted':True}
    boundary=CmlWebBoundary(app,audience=audience,session_factory=factory,resolve_identity=lambda *_:{'state':{},'public':{'admin':True}},ui_root=tmp_path)
    with TestClient(boundary) as client:
        def call(method='PATCH',body=b'{}',**patch):
            signed=assertion(key,audience,path='/cml-web/'+route,method=method,body=body,**patch)
            return client.request(method,'/cml-web/'+route,headers={'Origin':'https://kajovocml.hcasc.cz','X-CML-Web-Prefix':'/sections/'+audience+'/','X-CML-Web-Assertion':signed,'X-CSRF-Token':'a'*43,'Content-Type':'application/json'},content=body)
        assert call('GET',body=b'').status_code==200
        assert call().status_code==403
        assert call(reauthUntil=int(time.time())-1).status_code==403
        assert call(reauthUntil=int(time.time())+120).status_code==200
        assert call(body=b'{"password":"synthetic-local-only"}',reauthUntil=int(time.time())+120).status_code==401
        assert call('GET',body=b'',sub='user:'+str(uuid.uuid4()),nativeId='1').status_code==401
        assert calls==['GET','PATCH']
    engine.dispose()
