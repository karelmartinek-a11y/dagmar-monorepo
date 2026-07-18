# Volitelné přihlášení Google a Apple

Dagmar nadále používá interní účty, hesla, zaměstnanecké bearer tokeny, `employment_id` a administrátorskou session s CSRF. Google OpenID Connect a Sign in with Apple jsou pouze volitelné ověření již propojeného interního účtu. Systém nikdy nezakládá účet ani nepáruje podle e-mailu.

## Callback URL

- Google: `https://dagmar.hcasc.cz/api/v1/auth/google/callback`
- Apple: `https://dagmar.hcasc.cz/api/v1/auth/apple/callback`

Google klient musí být typu Web application a potřebuje jen scopes `openid email profile`. Apple Services ID musí být spojené s primary App ID, doménou `dagmar.hcasc.cz` a uvedenou Return URL. Apple callback používá `response_mode=form_post`.

## Secrets a zapnutí

Proměnné jsou popsány v `.env.example`. Poskytovatel je ve výchozím stavu vypnutý. Při zapnutí backend při startu ověří úplnost kritické konfigurace; Apple navíc vyžaduje čitelný `.p8` soubor mimo repozitář. Doporučené umístění je `/etc/dagmar/secrets/apple-signin-key.p8`, vlastník uživatel backendové služby a oprávnění `0600`.

Apple client secret se generuje serverově jako krátkodobý ES256 JWT. Google client secret, Apple privátní klíč ani žádný poskytovatelský token se neposílají do frontendu nebo logů.

## Bezpečnostní model

OAuth transakce jsou v PostgreSQL, mají 10minutovou expiraci, kryptografický `state`, `nonce`, browser binding, explicitní `employee/admin` a `login/link` kontext a jednorázové spotřebování. Google používá PKCE S256. ID tokeny se ověřují proti discovery/JWKS včetně podpisu, `iss`, `aud`, `exp`, `iat`, `nonce` a `azp`. JWKS respektují cache a při neznámém `kid` se jednou obnoví.

Propojení i odpojení vyžaduje aktuální interní heslo. Povolené návratové cesty jsou pevně omezené na `/app`, `/admin/prehled` a `/admin/ucet`. Externí token se nikdy nestává Dagmar autorizací.

## Nasazení a rollback

1. Zálohujte databázi a ověřte aktuální Alembic revision.
2. Nasaďte kód a spusťte `alembic upgrade head` před restartem backendu.
3. Nakonfigurujte nejprve jednoho poskytovatele, restartujte a ověřte `/api/v1/auth/providers`.
4. Pro rollback nejprve vypněte oba feature flagy. Downgrade `2026_07_18_0019` odstraní pouze externí vazby, transakce a jejich audit; interní hesla a účty nemění.

Pro produkční ověření je nutný skutečný Google OAuth klient, Apple Developer konfigurace a autorizované externí testovací účty. Zrušení vazby nerevokuje provider consent, protože Dagmar neukládá refresh tokeny a nepoužívá Google/Apple API.
