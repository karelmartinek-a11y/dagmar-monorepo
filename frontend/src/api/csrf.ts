import { apiFetch, ApiError } from "./client";

type CsrfTokenResponse = {
  csrf_token: string;
};

function safeSessionStorageGet(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("dagmar_csrf") || null;
  } catch {
    return null;
  }
}

function safeSessionStorageSet(token: string) {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("dagmar_csrf", token);
  } catch {
    // ignore
  }
}

function readCookieToken(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("dagmar_csrf_token="));
    if (!match) return null;
    const token = decodeURIComponent(match.split("=").slice(1).join("=") || "");
    return token || null;
  } catch {
    return null;
  }
}

export function getCsrfToken(): string | null {
  return safeSessionStorageGet() || readCookieToken();
}

export function setCsrfToken(token: string) {
  safeSessionStorageSet(token);
}

async function refreshCsrfToken(): Promise<string> {
  const res = await apiFetch<CsrfTokenResponse>("/api/v1/admin/csrf", { method: "GET" });
  if (!res?.csrf_token) throw new ApiError(500, "CSRF token missing");
  setCsrfToken(res.csrf_token);
  return res.csrf_token;
}

export async function ensureCsrfToken(): Promise<string> {
  return getCsrfToken() || (await refreshCsrfToken());
}

export function withCsrf(headers?: Record<string, string>): Record<string, string> {
  const token = getCsrfToken();
  return {
    ...(headers || {}),
    ...(token ? { "X-CSRF-Token": token } : {}),
  };
}
