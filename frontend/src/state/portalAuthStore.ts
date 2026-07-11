import type { PortalLoginEmployment } from "../api/portal";

export type PortalAuthState = {
  accessToken: string | null;
  employmentId: number | null;
  displayName: string | null;
  employments: PortalLoginEmployment[];
};

const STORAGE_KEY = "dagmar_portal_auth_v2";

function read(): PortalAuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, employmentId: null, displayName: null, employments: [] };
    const parsed = JSON.parse(raw) as Partial<PortalAuthState>;
    return {
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      employmentId: typeof parsed.employmentId === "number" ? parsed.employmentId : null,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : null,
      employments: Array.isArray(parsed.employments) ? parsed.employments : [],
    };
  } catch {
    return { accessToken: null, employmentId: null, displayName: null, employments: [] };
  }
}

function write(state: PortalAuthState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function remove() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getPortalAuthState(): PortalAuthState {
  return read();
}

export function setPortalAuthState(next: PortalAuthState) {
  write(next);
}

export function clearPortalAuthState() {
  remove();
}
