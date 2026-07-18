import { describe, expect, it } from "vitest";
import { coreSupportedLanguages, resources } from "../src/i18n/resources";

type PlainObject = Record<string, unknown>;

function flattenKeys(value: PlainObject, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) return flattenKeys(child as PlainObject, next);
    return [next];
  });
}

describe("i18n resources", () => {
  it("keeps the same translation keys in every supported language", () => {
    const baseline = flattenKeys(resources.cs.translation).sort();
    for (const language of coreSupportedLanguages) {
      const keys = flattenKeys(resources[language].translation).sort();
      expect(keys, `translation keys for ${language}`).toEqual(baseline);
    }
  });

  it("keeps complete Hindi keys for the employee portal and reset flow only", () => {
    expect(flattenKeys(resources.hi.translation.employee).sort()).toEqual(
      flattenKeys(resources.cs.translation.employee).sort(),
    );
    expect(flattenKeys(resources.hi.translation.auth.reset).sort()).toEqual(
      flattenKeys(resources.cs.translation.auth.reset).sort(),
    );
    expect(flattenKeys(resources.hi.translation.auth.hero).sort()).toEqual(
      flattenKeys(resources.cs.translation.auth.hero).sort(),
    );
    expect("adminOps" in resources.hi.translation).toBe(false);
    expect("integrationDocs" in resources.hi.translation).toBe(false);
  });

  it("does not contain duplicate flattened keys in the Czech baseline", () => {
    const keys = flattenKeys(resources.cs.translation);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
