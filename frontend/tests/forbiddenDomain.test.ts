import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_DOMAIN = "dochazka.hcasc.cz";
const FILE_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(FILE_PATH), "..");
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".yml",
  ".yaml",
  ".txt",
  ".env",
]);

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, acc);
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry.name)) || entry.name === ".env.example") {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe("zakazana historicka domena", () => {
  it("neni pritomna ve frontendovem repozitari", () => {
    const hits = collectFiles(ROOT)
      .filter((filePath) => filePath !== FILE_PATH)
      .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(FORBIDDEN_DOMAIN))
      .map((filePath) => path.relative(ROOT, filePath));

    expect(hits).toEqual([]);
  });
});
