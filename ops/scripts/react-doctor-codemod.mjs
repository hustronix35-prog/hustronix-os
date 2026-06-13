/**
 * Bulk fixes for react-doctor design rules in apps/web.
 * Run: node ops/scripts/react-doctor-codemod.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/web/src",
);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** Collapse matching w/h and px/py Tailwind pairs when values are identical. */
function fixTailwindClasses(text) {
  let next = text;
  const token = String.raw`[\w.]+(?:\/[\w.%]+)?`;
  next = next.replace(
    new RegExp(String.raw`\bw-(${token})\s+h-\1\b`, "g"),
    "size-$1",
  );
  next = next.replace(
    new RegExp(String.raw`\bh-(${token})\s+w-\1\b`, "g"),
    "size-$1",
  );
  next = next.replace(
    new RegExp(String.raw`\bpx-(${token})\s+py-\1\b`, "g"),
    "p-$1",
  );
  next = next.replace(
    new RegExp(String.raw`\bpy-(${token})\s+px-\1\b`, "g"),
    "p-$1",
  );
  return next;
}

/** Replace em dash in JSX/copy (react-doctor/design-no-em-dash-in-jsx-text). */
function fixEmDash(text) {
  return text.replace(/\u2014/g, ",");
}

let changed = 0;
for (const file of walk(webSrc)) {
  const before = fs.readFileSync(file, "utf8");
  let after = fixTailwindClasses(before);
  if (file.endsWith(".tsx")) after = fixEmDash(after);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed += 1;
  }
}
console.log(`Updated ${changed} files under ${webSrc}`);
