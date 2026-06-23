import { describe, expect, it } from "vitest";
import { getAdminFallbackPath, sanitizeAdminNextPath } from "../src/utils/adminLogin";

describe("admin login next-path sanitizace", () => {
  const origin = "https://dagmar.hcasc.cz";

  it("propusti nove admin routy prehled a instances", () => {
    expect(sanitizeAdminNextPath("?next=/admin/prehled", origin)).toBe("/admin/prehled");
    expect(sanitizeAdminNextPath("?next=/admin/instances", origin)).toBe("/admin/instances");
    expect(sanitizeAdminNextPath("?next=/admin/integrace", origin)).toBe("/admin/integrace");
  });

  it("vrati fallback pro cizi nebo nebezpecne cesty", () => {
    expect(sanitizeAdminNextPath("?next=/admin/neco-jineho", origin)).toBe(getAdminFallbackPath());
    expect(sanitizeAdminNextPath("?next=//evil.example", origin)).toBe(getAdminFallbackPath());
    expect(sanitizeAdminNextPath("", origin)).toBe(getAdminFallbackPath());
  });
});
