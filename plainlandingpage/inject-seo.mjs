/**
 * Inject SEO + AI discovery assets into plainlandingpage (static HTML).
 * Run: node inject-seo.mjs  (optional: SITE_URL=https://yoursite.netlify.app)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  homeJsonLd,
  jsonLdScript,
  llmsTxt,
  loadSiteConfig,
  metaBlock,
  pageJsonLd,
  PAGES,
  robotsTxt,
  sitemapXml,
} from "./lib/seo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHARED_STYLES = `
<link rel="stylesheet" href="styles.css"/>
<link rel="stylesheet" href="landing-extra.css"/>
<script>document.documentElement.setAttribute("data-theme","dark");</script>
`.trim();

function replaceHead(html, innerHead) {
  return html.replace(/<head>[\s\S]*?<\/head>/i, `<head>${innerHead}</head>`);
}

function replaceBodyJsonLd(html, newScript) {
  const re = /<script type="application\/ld\+json">[\s\S]*?<\/script>/i;
  if (re.test(html)) return html.replace(re, newScript);
  return html.replace(/<body[^>]*>/i, (m) => `${m}${newScript}`);
}

function injectHome(cfg) {
  const file = path.join(__dirname, "index.html");
  let html = fs.readFileSync(file, "utf8");
  const head = `${metaBlock({
    title: cfg.home.title,
    description: cfg.home.description,
    canonical: cfg.url,
    cfg,
  })}
${SHARED_STYLES}`;
  html = replaceHead(html, head);
  html = replaceBodyJsonLd(html, jsonLdScript(homeJsonLd(cfg)));
  fs.writeFileSync(file, html);
}

function injectSubpage(cfg, key) {
  const page = PAGES[key];
  const file = path.join(__dirname, page.file);
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, "utf8");
  const title = `${page.title} — ${cfg.name}`;
  const canonical = `${cfg.url}${page.path}`;
  const head = `${metaBlock({
    title,
    description: page.description,
    canonical,
    cfg,
  })}
<link rel="stylesheet" href="styles.css"/>
<link rel="stylesheet" href="site-pages.css"/>
<link rel="icon" href="${cfg.iconPath}" type="image/png"/>
<script>document.documentElement.setAttribute("data-theme","dark");</script>`;
  html = replaceHead(html, head);
  html = replaceBodyJsonLd(
    html,
    jsonLdScript(pageJsonLd(cfg, { path: page.path, title, description: page.description })),
  );
  fs.writeFileSync(file, html);
}

function writeRootFiles(cfg) {
  fs.writeFileSync(path.join(__dirname, "robots.txt"), robotsTxt(cfg));
  fs.writeFileSync(path.join(__dirname, "sitemap.xml"), sitemapXml(cfg));
  fs.writeFileSync(path.join(__dirname, "llms.txt"), llmsTxt(cfg));
}

function updateNetlifyToml() {
  const tomlPath = path.join(__dirname, "netlify.toml");
  let toml = fs.readFileSync(tomlPath, "utf8");
  const block = `
# Clean URLs for SEO (200 rewrite keeps canonical paths without .html)
[[redirects]]
  from = "/privacy"
  to = "/privacy.html"
  status = 200

[[redirects]]
  from = "/terms"
  to = "/terms.html"
  status = 200

[[redirects]]
  from = "/cookies"
  to = "/cookies.html"
  status = 200

[[redirects]]
  from = "/contact"
  to = "/contact.html"
  status = 200
`;
  if (!toml.includes('from = "/privacy"')) {
    toml = toml.trimEnd() + block;
    fs.writeFileSync(tomlPath, toml + "\n");
  }
}

function main() {
  const cfg = loadSiteConfig();
  injectHome(cfg);
  for (const key of Object.keys(PAGES)) injectSubpage(cfg, key);
  writeRootFiles(cfg);
  updateNetlifyToml();
  console.log(`SEO injected for ${cfg.url}`);
  console.log("Wrote robots.txt, sitemap.xml, llms.txt");
}

main();
