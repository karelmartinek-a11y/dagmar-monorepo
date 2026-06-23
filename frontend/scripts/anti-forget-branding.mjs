import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = globalThis.process.cwd();
const scanRoots = ['src', 'public', 'index.html', 'package.json'];
const forbidden = [
  ['device', 'Fingerprint'].join(''),
  ['claim', '-', 'token'].join(''),
  ['claim', 'Token'].join(''),
  ['register', 'Instance'].join(''),
  ['get', 'Instance', 'Status'].join(''),
  ['activation', 'State'].join(''),
  ['"', '/pending', '"'].join(''),
  ['Pending', 'Page'].join(''),
  ['"', '/brand/', '"'].join(''),
];
const textExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json', '.md', '.mjs']);

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isFile()) {
    out.push(path);
    return out;
  }
  for (const e of readdirSync(path)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    walk(join(path, e), out);
  }
  return out;
}

const files = [];
for (const p of scanRoots) {
  try {
    files.push(...walk(join(root, p)));
  } catch {
    // optional path
  }
}

const issues = [];
for (const abs of files) {
  const rel = relative(root, abs);
  if (![...textExt].some((e) => rel.endsWith(e)) && !rel.endsWith('index.html') && !rel.endsWith('package.json')) continue;
  const txt = readFileSync(abs, 'utf8');
  for (const token of forbidden) {
    if (txt.includes(token)) issues.push(`${rel}: forbidden token ${token}`);
  }
  const logoRefs = txt.match(/(["'`])\/(?!LOGO\/)([^"'`]*\.(?:png|svg|ico))/g) || [];
  for (const ref of logoRefs) {
    if (ref.includes('/download/')) continue;
    if (ref.includes('/api/')) continue;
    if (ref.includes('/frontend-version.json')) continue;
    if (ref.includes('/site.webmanifest')) continue;
    issues.push(`${rel}: non-LOGO asset reference ${ref}`);
  }
}

if (issues.length) {
  console.error('Branding anti-forget checks failed:');
  for (const i of issues) console.error(`- ${i}`);
  globalThis.process.exit(1);
}

console.log('Branding anti-forget checks passed.');
