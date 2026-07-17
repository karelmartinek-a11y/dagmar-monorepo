import { describe, expect, it } from "vitest";
import { resources, supportedLanguages } from "../src/i18n/resources";

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
    for (const language of supportedLanguages) {
      const keys = flattenKeys(resources[language].translation).sort();
      expect(keys, `translation keys for ${language}`).toEqual(baseline);
    }
  });

  it("does not contain duplicate flattened keys in the Czech baseline", () => {
    const keys = flattenKeys(resources.cs.translation);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
