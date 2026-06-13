/**
 * Turn a Markdown QA/report file into styled HTML (GitHub-like tables, bold, lists).
 * Optionally emit PDF via Puppeteer (same look as print).
 *
 * Usage:
 *   node ops/scripts/markdown-to-readable.mjs [path/to/file.md] [--pdf]
 *
 * Default input if omitted:
 *   .gstack/qa-reports/gstack-full-review-2026-05-06.md (when present)
 *
 * Outputs next to the source file:
 *   - same basename .html   (always)
 *   - same basename .pdf    (with --pdf)
 *
 * Dependencies (npm): markdown-it, markdown-it-multimd-table, github-markdown-css, puppeteer (root dep)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import MarkdownIt from "markdown-it";
import multimdTable from "markdown-it-multimd-table";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const argv = process.argv.slice(2);
const wantPdf = argv.includes("--pdf");
const posArgs = argv.filter((a) => a !== "--pdf");

let inPath = posArgs[0];
if (!inPath) {
  const def = path.join(ROOT, ".gstack", "qa-reports", "gstack-full-review-2026-05-06.md");
  if (fs.existsSync(def)) inPath = def;
}
if (!inPath || !fs.existsSync(inPath)) {
  console.error(
    "Usage: node ops/scripts/markdown-to-readable.mjs <file.md> [--pdf]\n" +
      "Or place .gstack/qa-reports/gstack-full-review-2026-05-06.md as default.",
  );
  process.exit(1);
}

inPath = path.resolve(inPath);

const cssPath = path.join(ROOT, "node_modules", "github-markdown-css", "github-markdown-light.css");
if (!fs.existsSync(cssPath)) {
  console.error("Missing github-markdown-css. Run: npm install github-markdown-css --save-dev");
  process.exit(1);
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
}).use(multimdTable);

const bodyMd = fs.readFileSync(inPath, "utf8");
const innerHtml = md.render(bodyMd);

const css = fs.readFileSync(cssPath, "utf8");
const title = path.basename(inPath, path.extname(inPath));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
${css}
    body { background: #ffffff; color: #1f2328; }
    .markdown-body { box-sizing: border-box; min-width: 200px; max-width: 920px; margin: 0 auto; padding: 3rem 2rem 4rem; }
    @media print {
      .markdown-body { max-width: none; padding: 1rem; }
      body { background: #fff; }
    }
  </style>
</head>
<body>
  <article class="markdown-body">
${innerHtml}
  </article>
</body>
</html>`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

const outHtml = inPath.replace(/\.md$/i, "") + ".html";
fs.writeFileSync(outHtml, html, "utf8");
console.log("Wrote:", outHtml);
console.log("Open this file in a browser for formatted tables and emphasis.");

if (wantPdf) {
  const outPdf = inPath.replace(/\.md$/i, "") + ".pdf";
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(outHtml).href, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await page.pdf({
    path: outPdf,
    format: "Letter",
    margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
    printBackground: true,
  });
  await browser.close();
  console.log("Wrote:", outPdf);
}
