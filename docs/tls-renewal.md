# Automatická obnova TLS

Produkční Nginx a KCML používají certifikáty z `/etc/letsencrypt`. Obnovu všech
lineages provádí `dagmar-certbot-renew.timer` dvakrát denně přes WEDOS DNS-01.
Vendor `certbot.timer` nesmí být současně aktivní.

## Secret

Na serveru musí existovat pouze root-only soubor
`/etc/letsencrypt/wedos-wapi.env` s režimem `0600` a vlastníkem `root:root`:

```dotenv
WEDOS_WAPI_LOGIN=...
WEDOS_WAPI_PASSWORD=...
WEDOS_WAPI_URL=https://api.wedos.com/wapi/json
WEDOS_WAPI_ZONE=hcasc.cz
```

WAPI musí povolit produkční IPv4 i IPv6. Secret se nesmí ukládat do repozitáře,
GitHub Actions secretů ani deploy artefaktů.

## Kontrola

```bash
systemctl status dagmar-certbot-renew.timer
systemctl status dagmar-certbot-renew.service
journalctl -u dagmar-certbot-renew.service --since today
certbot certificates
certbot renew --dry-run --non-interactive
```

Po úspěšné obnově deploy hook validuje Nginx konfiguraci, reloaduje Nginx a při
obnově `wildcard.hcasc.cz` nebo `kcml-wildcards` restartuje aktivní `kcml.service`.
DNS hook zapisuje pouze TXT challenge do zóny `hcasc.cz`, čeká na všechny
autoritativní WEDOS nameservery a při cleanupu maže pouze vlastní řádek.
