import { FormEvent, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { Brand } from "../components/Brand";
import { ExternalLoginButtons } from "../components/ExternalLoginButtons";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button, Field, StatusMessage } from "../components/Primitives";
import { normalizeAdminNextPath } from "../utils/adminAuth";

function AuthFrame({
  title,
  description,
  children,
  languageSurface = "core",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  languageSurface?: "core" | "employee";
}) {
  const { t } = useTranslation();
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-story__top">
          <Brand />
          <LanguageSwitcher surface={languageSurface} />
        </div>
        <div>
          <h1>
            {t("auth.hero.titleLead")} <span>{t("auth.hero.titleAccent")}</span>
          </h1>
          <p>{t("auth.hero.description")}</p>
        </div>
        <small>{t("auth.hero.footer")}</small>
      </section>
      <section className="auth-board">
        <div className="auth-card">
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

export function AdminLoginPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const next = new URLSearchParams(location.search).get("next");
  const safeNext = normalizeAdminNextPath(next);
  const providers = useQuery({ queryKey: ["external-providers"], queryFn: api.externalProviders, retry: false });
  const externalError = new URLSearchParams(location.search).get("external_auth_error");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await api.adminLogin(username, password);
      queryClient.removeQueries({ queryKey: ["admin-me"] });
      navigate(safeNext, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.admin.fallbackError"));
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthFrame
      title={t("auth.admin.title")}
      description={t("auth.admin.description")}
    >
      <form onSubmit={submit}>
        <Field label={t("auth.admin.username")}>
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label={t("auth.admin.password")}>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <StatusMessage kind="error" title={t("auth.admin.errorTitle")}>
            {error}
          </StatusMessage>
        )}
        <Button disabled={pending}>
          {pending ? t("auth.admin.submitting") : t("auth.admin.submit")}
        </Button>
      </form>
      <ExternalLoginButtons
        enabled={providers.data}
        getUrl={(provider) => api.externalLoginUrl("admin", provider, safeNext)}
        portal="admin"
      />
      {externalError && <StatusMessage kind="error" title={t("auth.external.failedTitle")}>{t("auth.external.adminFailed")}</StatusMessage>}
    </AuthFrame>
  );
}

export function ResetPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("auth.reset.passwordTooShort"));
      return;
    }
    if (password !== repeat) {
      setError(t("auth.reset.passwordsMismatch"));
      return;
    }
    setState("pending");
    try {
      await api.portalReset(token, password);
      setState("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("auth.reset.fallbackError"),
      );
      setState("idle");
    }
  };
  return (
    <AuthFrame
      languageSurface="employee"
      title={t("auth.reset.title")}
      description={t("auth.reset.description")}
    >
      {state === "done" ? (
        <>
          <StatusMessage kind="success" title={t("auth.reset.successTitle")}>
            {t("auth.reset.successBody")}
          </StatusMessage>
          <a className="button button--primary" href="/app">
            {t("auth.reset.continueToLogin")}
          </a>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field
            label={t("auth.reset.password")}
            hint={t("auth.reset.passwordHint")}
          >
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label={t("auth.reset.repeat")}>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
          {!token && (
            <StatusMessage
              kind="error"
              title={t("auth.reset.tokenMissingTitle")}
            >
              {t("auth.reset.tokenMissingBody")}
            </StatusMessage>
          )}
          {error && (
            <StatusMessage kind="error" title={t("auth.reset.errorTitle")}>
              {error}
            </StatusMessage>
          )}
          <Button disabled={!token || state === "pending"}>
            {state === "pending"
              ? t("auth.reset.submitting")
              : t("auth.reset.submit")}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const query = useQuery({
    queryKey: ["admin-me"],
    queryFn: api.adminMe,
    retry: false,
    staleTime: 30_000,
  });
  if (query.isPending)
    return (
      <main className="auth-page">
        <section className="auth-story">
          <Brand />
        </section>
        <section className="auth-board">
          <StatusMessage
            kind="loading"
            title={t("auth.admin.verifyingSession")}
          />
        </section>
      </main>
    );
  if (query.isError || !query.data?.authenticated)
    return (
      <Navigate
        to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return children;
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <AuthFrame
      title={t("auth.notFound.title")}
      description={t("auth.notFound.description")}
    >
      <a className="button button--primary" href="/app">
        {t("auth.notFound.cta")}
      </a>
    </AuthFrame>
  );
}
