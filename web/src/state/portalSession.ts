import type { PortalLogin, PortalSession } from "../api/types";
import { setPortalToken } from "../api/client";

const KEY = "kajovodagmar.portal.session.v1";

export function loadPortalSession(): PortalSession | null {
  try {
    const value = localStorage.getItem(KEY);
    if (!value) return null;
    const session = JSON.parse(value) as PortalSession;
    if (!session.instance_token || !Array.isArray(session.available_employments)) return null;
    setPortalToken(session.instance_token);
    return session;
  } catch { return null; }
}

export function savePortalLogin(login: PortalLogin): PortalSession {
  const session = { ...login, selected_employment_id: login.employment_id };
  localStorage.setItem(KEY, JSON.stringify(session));
  setPortalToken(session.instance_token);
  return session;
}

export function selectEmployment(session: PortalSession, employmentId: number): PortalSession {
  const next = { ...session, selected_employment_id: employmentId };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearPortalSession() {
  localStorage.removeItem(KEY);
  setPortalToken(null);
}
