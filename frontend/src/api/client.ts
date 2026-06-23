// DAGMAR frontend API client
// - Uses fetch
// - Attaches instance token when available
// - Provides small retry/backoff helpers for polling endpoints
// - Never stores attendance offline; only access token and UI state may be persisted elsewhere

export type ApiErrorBody = {
  code?: string;
  message?: string;
  detail?: string;
  details?: unknown;
};

export class ApiError extends Error {
  public readonly status: number;
  public readonly body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export type FetchJsonOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  instanceToken?: string | null;
  csrfToken?: string | null;
};

function buildUrl(path: string, query?: FetchJsonOptions['query']): string {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function readErrorBody(resp: Response): Promise<ApiErrorBody | undefined> {
  const ct = resp.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      return (await resp.json()) as ApiErrorBody;
    }
    const text = await resp.text();
    if (!text) return undefined;
    return { message: text };
  } catch {
    return undefined;
  }
}

export async function fetchJson<T>(opts: FetchJsonOptions): Promise<T> {
  const method = opts.method ?? 'GET';
  const url = buildUrl(opts.path, opts.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };

  // Admin session uses cookie; include credentials for admin endpoints.
  // Employee endpoints typically don't need cookies, but harmless.
  const credentials = opts.credentials ?? 'include';

  if (opts.instanceToken) {
    headers.Authorization = `Bearer ${opts.instanceToken}`;
  }
  // CSRF header for admin state-changing endpoints.
  if (opts.csrfToken) {
    headers['X-CSRF-Token'] = opts.csrfToken;
  }

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    const val = opts.body as unknown;
    if (
      typeof val === 'string' ||
      val instanceof FormData ||
      val instanceof Blob ||
      val instanceof ArrayBuffer ||
      val instanceof URLSearchParams
    ) {
      body = val as BodyInit;
      // Leave Content-Type untouched for FormData; caller can override for strings.
      if (typeof val === 'string') {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }

  const resp = await fetch(url, {
    method,
    headers,
    body,
    credentials,
    signal: opts.signal,
  });

  if (!resp.ok) {
    const errBody = await readErrorBody(resp);
    const msg = errBody?.message || `HTTP ${resp.status}`;
    throw new ApiError(resp.status, msg, errBody);
  }

  // 204 No Content
  if (resp.status === 204) return undefined as unknown as T;

  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // For endpoints that return downloads, caller should not use fetchJson.
    // Keep this strict to surface misuses early.
    const text = await resp.text();
    throw new ApiError(
      500,
      'Server returned non-JSON response where JSON was expected.',
      { message: text }
    );
  }

  return (await resp.json()) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  // Return true if the error is retryable.
  retryOn?: (err: unknown) => boolean;
};

export async function withRetry<T>(fn: () => Promise<T>, ro: RetryOptions): Promise<T> {
  let attempt = 0;
  // Deterministic jitter (none). Keep deterministic for predictable polling.
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const retryable = ro.retryOn ? ro.retryOn(err) : isRetryableError(err);
      if (!retryable || attempt >= ro.maxAttempts) throw err;
      const delay = Math.min(ro.maxDelayMs, ro.baseDelayMs * Math.pow(2, attempt - 1));
      await sleep(delay);
    }
  }
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    // Retry transient server and rate limit responses; do not retry auth/validation.
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    return false;
  }
  // Network errors / aborted requests can be transient.
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  return true;
}

export function downloadUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
  return buildUrl(path, query);
}

// ---- Legacy-compatible helpers -------------------------------------------------

export type LegacyFetchInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: FetchJsonOptions['query'];
  instanceToken?: string | null;
  csrfToken?: string | null;
};

export async function apiFetch<T>(pathOrOpts: string | FetchJsonOptions, init?: LegacyFetchInit): Promise<T> {
  if (typeof pathOrOpts !== 'string') {
    return fetchJson<T>(pathOrOpts);
  }

  const method =
    typeof init?.method === 'string' && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(init.method)
      ? (init.method as FetchJsonOptions['method'])
      : undefined;
  const opts: FetchJsonOptions = {
    path: pathOrOpts,
    method: method ?? 'GET',
    query: init?.query,
    headers: init?.headers as Record<string, string> | undefined,
    credentials: init?.credentials,
    signal: init?.signal ?? undefined,
    instanceToken: init?.instanceToken ?? undefined,
    csrfToken: init?.csrfToken ?? undefined,
  };

  if (init?.body !== undefined) {
    opts.body = init.body;
  }

  return fetchJson<T>(opts);
}

export async function httpJson<T>(path: string, init?: LegacyFetchInit & { body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  return apiFetch<T>(path, {
    ...init,
    headers,
    body: init?.body,
  });
}
