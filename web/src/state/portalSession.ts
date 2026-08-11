import type { Employment, PortalLogin, PortalSession } from "../api/types";

const LEGACY_KEY = "kajovodagmar.portal.session.v1";

// Remove the historical bearer-bearing record; browser credentials now live only
// in the backend-issued HttpOnly cookie.
function removeLegacyCredential() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage can be disabled; the server-side cookie remains authoritative.
  }
}

removeLegacyCredential();

export function savePortalLogin(login: PortalLogin): PortalSession {
  return { ...login, selected_employment_id: login.employment_id };
}

export function selectEmployment(session: PortalSession, employmentId: number): PortalSession {
  return { ...session, selected_employment_id: employmentId };
}

export function replaceAvailableEmployments(session: PortalSession, employments: Employment[]): PortalSession {
  const selected = employments.some((item) => item.id === session.selected_employment_id)
    ? session.selected_employment_id
    : (employments[0]?.id ?? null);
  return { ...session, available_employments: employments, selected_employment_id: selected };
}

export function clearPortalSession() {
  removeLegacyCredential();
}
