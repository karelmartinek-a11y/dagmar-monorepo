const ADMIN_DEFAULT_PATH = "/admin/prehled";
const ADMIN_LOGIN_PATH = "/admin/login";

export function normalizeAdminNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return ADMIN_DEFAULT_PATH;
  }
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return ADMIN_DEFAULT_PATH;
    if (url.pathname === ADMIN_LOGIN_PATH || url.pathname.startsWith(`${ADMIN_LOGIN_PATH}/`)) {
      return ADMIN_DEFAULT_PATH;
    }
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) {
      return ADMIN_DEFAULT_PATH;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return ADMIN_DEFAULT_PATH;
  }
}
