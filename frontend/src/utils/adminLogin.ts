const ADMIN_FALLBACK_PATH = "/admin/prehled";

const VALID_ADMIN_PATHS = new Set([
  "/admin",
  "/admin/prehled",
  "/admin/users",
  "/admin/dochazka",
  "/admin/plan-sluzeb",
  "/admin/export",
  "/admin/tisky",
  "/admin/tisky/preview",
  "/admin/settings",
  "/admin/instances",
  "/admin/integrace",
]);

export function getAdminFallbackPath() {
  return ADMIN_FALLBACK_PATH;
}

export function sanitizeAdminNextPath(search: string, origin: string): string {
  const params = new URLSearchParams(search);
  const next = params.get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return ADMIN_FALLBACK_PATH;
  const pathname = new URL(next, origin).pathname;
  return VALID_ADMIN_PATHS.has(pathname) ? next : ADMIN_FALLBACK_PATH;
}
