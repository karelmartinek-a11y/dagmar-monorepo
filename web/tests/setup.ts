import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { i18n } from "../src/i18n";
import { languageStorageKey } from "../src/i18n/language";

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem(languageStorageKey, "cs");
  await i18n.changeLanguage("cs");
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
});
