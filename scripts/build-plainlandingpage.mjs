/**
 * Production bundle for plainlandingpage/ (Netlify deploy root).
 * Syncs the demand-validation landing from netlify-landing/ (form + functions + leads).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "netlify-landing");
const OUT = path.join(ROOT, "plainlandingpage");

const COPY_FILES = [
  "index.html",
  "styles.css",
  "site-pages.css",
  "landing-extra.css",
  "script.js",
  "hero-canvas.js",
  "hero-product-carousel.js",
  "landing-nav.js",
  "mechanism-carousel.js",
  "early-access.js",
  "contact.js",
  "contact.html",
  "site.config.json",
  "inject-seo.mjs",
  "lib/seo.mjs",
  "leads.js",
  "privacy.html",
  "terms.html",
  "cookies.html",
  "package.json",
  "netlify.toml",
  ".gitignore",
  ".env.example",
  ".env.leads.example",
  "dev-server.mjs",
];

const COPY_DIRS = ["brand", "netlify", "lib"];

const REMOVE_PATHS = ["_next", "landing.css"];

function rim(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function main() {
  if (!fs.existsSync(path.join(SRC, "index.html"))) {
    throw new Error("Run export first: npm run build:web && npm run start:unified && npm run export:netlify-landing");
  }

  for (const rel of REMOVE_PATHS) rim(path.join(OUT, rel));
  rim(path.join(OUT, "leads.html"));

  for (const rel of COPY_FILES) {
    const src = path.join(SRC, rel);
    if (!fs.existsSync(src)) {
      console.warn(`skip missing ${rel}`);
      continue;
    }
    copyFile(src, path.join(OUT, rel));
  }

  for (const rel of COPY_DIRS) {
    rim(path.join(OUT, rel));
    copyDir(path.join(SRC, rel), path.join(OUT, rel));
  }

  fs.mkdirSync(path.join(OUT, ".data"), { recursive: true });
  if (!fs.existsSync(path.join(OUT, ".data", ".gitkeep"))) {
    fs.writeFileSync(path.join(OUT, ".data", ".gitkeep"), "");
  }

  const deployDoc = path.join(OUT, "DEPLOY-NETLIFY.md");
  if (!fs.existsSync(deployDoc)) {
    console.warn("DEPLOY-NETLIFY.md missing — will be written by agent");
  }

  for (const script of ["apply-early-access-landing.mjs", "inject-seo.mjs"]) {
    const scriptPath = path.join(OUT, script);
    if (fs.existsSync(scriptPath)) {
      execSync(`node ${script}`, { cwd: OUT, stdio: "inherit" });
    }
  }

  console.log(`Built ${OUT} from ${SRC}`);
  console.log("Next: cd plainlandingpage && npm install && npm run dev");
}

main();
