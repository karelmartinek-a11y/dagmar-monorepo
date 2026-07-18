import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { api } from "../api/client";
import type { ExternalProvider } from "../api/types";
import { Button, Field, StatusMessage } from "./Primitives";

const labels: Record<ExternalProvider, string> = { google: "Google", apple: "Apple" };

export function AccountMethods({ portal }: { portal: "employee" | "admin" }) {
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
    onSuccess: async () => { setPassword(""); setMessage("Propojení bylo bezpečně zrušeno."); await qc.invalidateQueries({ queryKey: [portal, "auth-methods"] }); },
  });
  const params = new URLSearchParams(window.location.search);
  const linked = params.get("external_auth_linked");
  const error = link.error ?? unlink.error ?? query.error;
  return <section className="panel account-methods" aria-labelledby={`${portal}-auth-methods-title`}>
    <header className="panel__header"><div><p>Bezpečnost účtu</p><h2 id={`${portal}-auth-methods-title`}>Přihlašovací metody</h2></div><KeyRound /></header>
    <div className="panel-body stack">
      <p>Interní uživatelské jméno a heslo zůstávají vždy aktivní. Google a Apple lze použít pouze po předchozím propojení.</p>
      {(message || linked) && <StatusMessage kind="success" title="Změna byla dokončena">{message || `Účet ${labels[linked as ExternalProvider] ?? linked} byl propojen.`}</StatusMessage>}
      {error && <StatusMessage kind="error" title="Přihlašovací metodu nelze změnit">{error.message}</StatusMessage>}
      <Field label="Aktuální interní heslo" hint="Vyžaduje se znovu před propojením i odpojením.">
        <input type="password" aria-label="Aktuální interní heslo" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      {query.isPending && <StatusMessage kind="loading" title="Načítám přihlašovací metody" />}
      <div className="auth-method-list">
        {query.data?.methods.map((method) => <article key={method.provider} className="auth-method-card">
          <div><strong>{labels[method.provider]}</strong><span>{method.linked ? "Propojeno" : method.enabled ? "Není propojeno" : "Není nakonfigurováno"}</span>{method.identifier && <small>{method.identifier}</small>}{method.linked_at && <small>Propojeno {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" }).format(new Date(method.linked_at))}</small>}</div>
          {method.linked ? <Button variant="danger" disabled={!password || unlink.isPending} onClick={() => unlink.mutate(method.provider)}><Unlink /> Odpojit</Button> : <Button disabled={!password || !method.enabled || link.isPending} onClick={() => link.mutate(method.provider)}><Link2 /> Propojit</Button>}
        </article>)}
      </div>
    </div>
  </section>;
}
