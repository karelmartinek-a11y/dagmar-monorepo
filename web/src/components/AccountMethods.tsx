import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { ExternalProvider } from "../api/types";
import { Button, Field, StatusMessage } from "./Primitives";
import { getLocale } from "../i18n/language";
import type { AppLanguage } from "../i18n/resources";

const labels: Record<ExternalProvider, string> = { google: "Google", apple: "Apple" };

export function AccountMethods({ portal }: { portal: "employee" | "admin" }) {
  const { t, i18n } = useTranslation();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const qc = useQueryClient();
  const query = useQuery({ queryKey: [portal, "auth-methods"], queryFn: () => api.authMethods(portal), retry: false });
  const link = useMutation({
    mutationFn: (provider: ExternalProvider) => api.linkAuthMethod(portal, provider, password),
    onSuccess: ({ authorization_url }) => { setPassword(""); window.location.assign(authorization_url); },
  });
  const unlink = useMutation({
    mutationFn: (provider: ExternalProvider) => api.unlinkAuthMethod(portal, provider, password),
    onSuccess: async () => { setPassword(""); setMessage(t("account.unlinked")); await qc.invalidateQueries({ queryKey: [portal, "auth-methods"] }); },
  });
  const params = new URLSearchParams(window.location.search);
  const linked = params.get("external_auth_linked");
  const error = link.error ?? unlink.error ?? query.error;
  return <section className="panel account-methods" aria-labelledby={`${portal}-auth-methods-title`}>
    <header className="panel__header"><div><p>{t("account.eyebrow")}</p><h2 id={`${portal}-auth-methods-title`}>{t("account.title")}</h2></div><KeyRound /></header>
    <div className="panel-body stack">
      <p>{t("account.description")}</p>
      {(message || linked) && <StatusMessage kind="success" title={t("account.changed")}>{message || t("account.linked", { provider: labels[linked as ExternalProvider] ?? linked })}</StatusMessage>}
      {error && <StatusMessage kind="error" title={t("account.changeFailed")}>{error.message}</StatusMessage>}
      <Field label={t("account.currentPassword")} hint={t("account.currentPasswordHint")}>
        <input type="password" aria-label={t("account.currentPassword")} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      {query.isPending && <StatusMessage kind="loading" title={t("account.loading")} />}
      <div className="auth-method-list">
        {query.data?.methods.map((method) => <article key={method.provider} className="auth-method-card">
          <div><strong>{labels[method.provider]}</strong><span>{method.linked ? t("account.statusLinked") : method.enabled ? t("account.statusNotLinked") : t("account.statusNotConfigured")}</span>{method.identifier && <small>{method.identifier}</small>}{method.linked_at && <small>{t("account.linkedAt", { date: new Intl.DateTimeFormat(getLocale((i18n.resolvedLanguage ?? "cs") as AppLanguage), { dateStyle: "medium" }).format(new Date(method.linked_at)) })}</small>}</div>
          {method.linked ? <Button variant="danger" disabled={!password || unlink.isPending} onClick={() => unlink.mutate(method.provider)}><Unlink /> {t("account.unlink")}</Button> : <Button disabled={!password || !method.enabled || link.isPending} onClick={() => link.mutate(method.provider)}><Link2 /> {t("account.link")}</Button>}
        </article>)}
      </div>
    </div>
  </section>;
}
