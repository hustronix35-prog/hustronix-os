/**
 * Export the live landing page to netlify-landing/ (plain HTML + CSS + JS).
 * Prereq: npm run build:web && server on http://127.0.0.1:3005 (or set LANDING_EXPORT_URL).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeDemandLanding } from "./sanitize-netlify-demand.mjs";
import { writeLegalPages } from "./netlify-legal-pages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "netlify-landing");
const BASE = process.env.LANDING_EXPORT_URL || "http://127.0.0.1:3005";
const WEB = path.join(ROOT, "apps", "web");

/** CSS chunk filenames from fetched HTML (Next hashes change each build). */
function extractCssChunks(html) {
  const chunks = new Set();
  for (const m of html.matchAll(/\/_next\/static\/chunks\/([^"]+\.css)/g)) {
    chunks.add(m[1]);
  }
  return [...chunks];
}

const HERO_CANVAS_MARKUP = `<motion class="hero-canvas-fallback" aria-hidden="true"></motion>
<div id="hero-canvas-root" class="pointer-events-none absolute inset-0 z-[2] min-h-[99dvh] w-full" aria-hidden="true">
  <div class="pointer-events-none absolute left-1/2 top-[32%] z-[1] h-[min(52vh,400px)] w-[min(95vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(198,168,90,0.12),transparent_68%)] blur-3xl" aria-hidden="true"></motion>
  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[42%] bg-[radial-gradient(ellipse_90%_80%_at_50%_100%,rgba(198,168,90,0.09),transparent_72%)]" aria-hidden="true"></motion>
  <canvas id="hero-canvas" class="hero-canvas-el"></canvas>
</div>`;

/** Framer Motion SSR leaves opacity:0 inline — invisible without React. */
function fixMotionInlineStyles(html) {
  let n = 0;
  const out = html.replace(/style="([^"]*)"/g, (full, inner) => {
    if (!inner.includes("opacity:0")) return full;
    const rest = inner
      .replace(/opacity:0;?/g, "")
      .replace(/transform:[^;]+;?/g, "")
      .replace(/^;+|;+$/g, "")
      .trim();
    n += 1;
    const styleBit = rest ? ` style="${rest}"` : "";
    return `class="motion-reveal"${styleBit}`;
  });
  console.log(`  motion-reveal wrappers: ${n}`);
  return out;
}

function stripNextAssets(html) {
  const hero = HERO_CANVAS_MARKUP.replaceAll("<motion", "<div").replaceAll(
    "</motion>",
    "</div>",
  );
  return html
    .replace(/<link rel="stylesheet" href="\/_next\/[^"]+"[^>]*>/g, "")
    .replace(/<link rel="preload" as="style" href="\/_next\/[^"]+"[^>]*>/g, "")
    .replace(/<script[^>]*src="\/_next\/[^"]*"[^>]*><\/script>/gi, "")
    .replace(/<script[^>]*src="\/_next\/[^"]*"[^>]*\/>/gi, "")
    .replace(/<link rel="preload" as="script"[^>]*>/g, "")
    .replace(/<meta name="next-size-adjust"[^>]*>/g, "")
    .replace(
      /<script(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(/<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"><\/template>/g, "")
    .replace(/<!--\$!-->[\s\S]*?<!--\/\$-->/g, hero)
    .replace(/style="opacity:0;transform:translateY\(40px\)"/g, 'class="hero-reveal-item"')
    .replace(/style="opacity:0;transform:translateY\(36px\)"/g, 'class="hero-reveal-item"')
    .replace(/style="opacity:0;transform:translateY\(44px\)"/g, 'class="hero-reveal-item"')
    .replace(/style="opacity:0;transform:translateY\(52px\)"/g, 'class="hero-reveal-item"');
}

function readLandingGlobalsCss() {
  const globals = fs.readFileSync(
    path.join(WEB, "src", "app", "globals.css"),
    "utf8",
  );
  const start = globals.indexOf("/* —— Premium marketing");
  const end = globals.indexOf("/* Product tour", start);
  if (start < 0 || end < 0) return "";
  return globals.slice(start, end);
}

function injectStaticHead(html) {
  const extra = `
<link rel="stylesheet" href="styles.css"/>
<link rel="icon" href="brand/hustronix-mark.png" type="image/png"/>
<script>document.documentElement.setAttribute("data-theme","dark");</script>`;
  const scripts = `
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js"}}
</script>
<script type="module" src="hero-canvas.js"></script>
<script src="early-access.js" defer></script>
<script src="mechanism-carousel.js" defer></script>
<script src="script.js" defer></script>`;

  let out = html.replace(/<link rel="stylesheet" href="styles\.css"\/>/g, "");
  out = out.replace("</head>", `${extra}\n</head>`);
  out = out.replace("</body>", `${scripts}\n</body>`);
  out = out.replace(/\sclass="[^"]*inter_[^"]*"/, ' class="h-full"');
  return out;
}

function fixAssetPaths(html) {
  return html
    .replace(/<link rel="preload" href="\/_next\/[^"]+"[^>]*>/g, "")
    .replace(/<link rel="preload" as="image"[^>]*>/g, "")
    .replace(/src="\/_next\/image\?[^"]*"/g, 'src="brand/hustronix-logo.png"')
    .replace(/srcSet="\/_next\/image\?[^"]*"/g, 'srcSet="brand/hustronix-logo.png 1x, brand/hustronix-logo.png 2x"')
    .replace(/imageSrcSet="\/_next\/image\?[^"]*"/g, 'imageSrcSet="brand/hustronix-logo.png 1x, brand/hustronix-logo.png 2x"')
    .replace(/srcSet="\/brand\//g, 'srcSet="brand/')
    .replace(/src="\/brand\//g, 'src="brand/')
    .replace(/content="https:\/\/hustronix\.online\/brand\//g, 'content="brand/');
}

async function main() {
  console.log(`Fetching ${BASE}/ …`);
  const res = await fetch(`${BASE}/`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  let html = await res.text();
  const cssChunks = extractCssChunks(html);
  if (!cssChunks.length) {
    throw new Error("No /_next/static/chunks/*.css in HTML — is the server running?");
  }
  console.log(`  CSS chunks: ${cssChunks.join(", ")}`);

  html = stripNextAssets(html);
  html = fixMotionInlineStyles(html);
  html = fixAssetPaths(html);
  html = injectStaticHead(html);

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, "brand"), { recursive: true });

  const cssParts = [];
  for (const file of cssChunks) {
    const p = path.join(WEB, ".next", "static", "chunks", file);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing ${p} — run: npm run build:web`);
    }
    cssParts.push(`/* ${file} */\n${fs.readFileSync(p, "utf8")}`);
  }
  const extraCss = fs.readFileSync(
    path.join(ROOT, "netlify-landing", "landing-extra.css"),
    "utf8",
  );
  const landingGlobals = readLandingGlobalsCss();
  fs.writeFileSync(
    path.join(OUT, "styles.css"),
    `${cssParts.join("\n\n")}\n\n/* landing globals (from apps/web) */\n${landingGlobals}\n\n${extraCss}`,
  );

  html = sanitizeDemandLanding(html);
  fs.writeFileSync(path.join(OUT, "index.html"), html, "utf8");
  writeLegalPages(OUT);
  const netlifyToml = `[build]
  publish = "."

# Demand-validation site — no redirects to the main product app.

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
`;
  fs.writeFileSync(path.join(OUT, "netlify.toml"), netlifyToml, "utf8");

  for (const name of [
    "hustronix-logo.png",
    "hustronix-mark.png",
    "hustronix-lockup.png",
  ]) {
    const src = path.join(WEB, "public", "brand", name);
    const alt = path.join(WEB, "brand", name);
    const from = fs.existsSync(src) ? src : alt;
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(OUT, "brand", name));
    }
  }

  // Copy hand-written JS (not generated)
  for (const js of ["hero-canvas.js", "script.js"]) {
    const src = path.join(OUT, js);
    if (!fs.existsSync(src)) {
      console.warn(`Warning: missing ${src}`);
    }
  }

  console.log(`Wrote ${OUT}/index.html (${html.length} bytes)`);
  console.log(`Wrote ${OUT}/styles.css`);
  console.log("Demand-validation: pricing/product links stripped; legal + contact pages written.");
  console.log("Deploy: drag netlify-landing/ to Netlify. Set data-api-base on <html> to your API origin.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
