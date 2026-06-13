/**
 * Strip main-product links from netlify-landing/ for demand-validation hosting.
 * Does not modify apps/web — run after export-netlify-landing.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLegalPages } from "./netlify-legal-pages.mjs";
import { applyNetlifyLandingLayout } from "./netlify-landing-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "netlify-landing");
const INDEX = path.join(OUT, "index.html");

function removeSectionById(html, id) {
  const marker = `id="${id}"`;
  const idx = html.indexOf(marker);
  if (idx < 0) return html;
  const start = html.lastIndexOf("<section", idx);
  if (start < 0) return html;

  let depth = 0;
  let pos = start;
  while (pos < html.length) {
    const open = html.indexOf("<section", pos);
    const close = html.indexOf("</section>", pos);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      depth += 1;
      pos = open + 8;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return html.slice(0, start) + html.slice(close + "</section>".length);
    }
    pos = close + "</section>".length;
  }
  return html;
}

function removeFooterProductColumn(html) {
  return html.replace(
    /<div>\s*<h2[^>]*>Product<\/h2>[\s\S]*?<\/nav>\s*<\/div>\s*(?=<div>\s*<h2[^>]*>Company<\/h2>)/,
    "",
  );
}

function stripAppLinks(html) {
  let out = html;
  out = out.replace(
    /<a\b[^>]*href="\/teams"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
  out = out.replace(
    /<a\b[^>]*href="(?:\/#pricing|#pricing)"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
  out = out.replace(
    /<a\b[^>]*href="\/contact"[^>]*>([\s\S]*?)<\/a>/gi,
    '<a class="block text-sm text-hx-muted transition-colors duration-200 hover:text-landing-gold" href="contact.html">$1</a>',
  );
  out = out.replace(/href="\/privacy"/g, 'href="privacy.html"');
  out = out.replace(/href="\/terms"/g, 'href="terms.html"');
  out = out.replace(/href="\/cookies"/g, 'href="cookies.html"');
  out = out.replace(
    /<a\b[^>]*href="(?:\/mission-control|\/execute|\/signals|\/chat|\/reports)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
  out = out.replace(
    /<a\b[^>]*href="https:\/\/hustronix\.online[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    "",
  );
  return out;
}

export function sanitizeDemandLanding(html) {
  let out = html;
  out = removeSectionById(out, "pricing");
  out = removeFooterProductColumn(out);
  out = stripAppLinks(out);
  out = out.replace(
    /<html\b/,
    '<html data-demand-landing="1"',
  );
  for (const src of ["contact.js", "mechanism-carousel.js"]) {
    if (!out.includes(src)) {
      out = out.replace("</body>", `<script src="${src}" defer></script>\n</body>`);
    }
  }
  out = applyNetlifyLandingLayout(out);
  return out;
}

function writeNetlifyToml() {
  const toml = `[build]
  publish = "."

# Demand-validation site — no redirects to the main product app.

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
`;
  fs.writeFileSync(path.join(OUT, "netlify.toml"), toml, "utf8");
}

export function main() {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`Missing ${INDEX} — run: node scripts/export-netlify-landing.mjs`);
  }
  const html = fs.readFileSync(INDEX, "utf8");
  const sanitized = sanitizeDemandLanding(html);
  fs.writeFileSync(INDEX, sanitized, "utf8");
  writeLegalPages(OUT);
  writeNetlifyToml();
  console.log("Sanitized netlify-landing for demand validation (pricing/product links removed).");
  console.log("Wrote privacy.html, terms.html, cookies.html, contact.html");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
