import { readFile, readdir } from "node:fs/promises";

const root = new URL("../src/", import.meta.url);
const forbidden = ["dochazka" + ".hcasc.cz"];
let combined = "";
async function walk(url) {
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) await walk(child);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) combined += await readFile(child, "utf8");
  }
}
await walk(root);
if (!combined.includes("KájovoDagmar") || !combined.includes("DOCHÁZKOVÝ SYSTÉM")) throw new Error("Chybí závazný branding.");
for (const value of forbidden) if (combined.includes(value)) throw new Error(`Zakázaná doména: ${value}`);
console.log("Branding checks passed.");
