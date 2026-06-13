# Deploy `plainlandingpage` to Netlify (manual)

This folder is the **only** publish root for your marketing site. It includes:

- Early-access form on the homepage (`#early-access`)
- Netlify Functions that save submissions (Netlify Blobs in production)
- Private viewer: **`/spandanpatilleads.html`** (unlisted URL — do not link from the homepage)

## Before you deploy (local test)

**Use this folder’s dev server only** — not `npm run dev:unified` on port 3005 and not the main Next app. Those are the full product landing (Get Started / Sign in).

```bash
cd plainlandingpage
npm install
npm run dev
```

1. Open **http://127.0.0.1:8888/** — header **Early access**, hero button scrolls to the waitlist form at the bottom.
2. Submit the form with a test email.
3. Open **http://127.0.0.1:8888/spandanpatilleads.html** — confirm the row appears → **Refresh**.

After exporting from the main app, re-apply demand layout + SEO:

```bash
node apply-early-access-landing.mjs
node inject-seo.mjs
```

Rebuild this folder from the repo when the Next landing changes:

```bash
# from repo root (API + web running on 3005 for export)
npm run build:web
npm run start:unified
npm run export:netlify-landing
npm run build:plainlandingpage
```

---

## Manual deploy on Netlify

### 1. Create the site

1. Go to [https://app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** (or **Deploy manually**).
2. If using Git: connect the repo and set **Base directory** to `plainlandingpage`.
3. If deploying by drag-and-drop: zip the **`plainlandingpage`** folder contents (not the parent repo).

### 2. Build settings

| Setting | Value |
|--------|--------|
| **Base directory** | `plainlandingpage` (if repo root is Hustronix OS) |
| **Build command** | `npm install` |
| **Publish directory** | `.` (or `plainlandingpage` if base is repo root) |

`netlify.toml` in this folder already sets `publish = "."` and `functions` under `netlify/functions`.

### 3. Deploy

- **Git:** push → Netlify builds automatically.
- **Manual:** drag the `plainlandingpage` folder to Netlify **Deploys → Deploy manually**.

Wait until status is **Published**.

### 4. Verify production

1. `https://YOUR-SITE.netlify.app/` — submit early access.
2. `https://YOUR-SITE.netlify.app/spandanpatilleads.html` — submissions table loads without a password.
3. Row should appear after **Refresh**.

Do not link `spandanpatilleads.html` from the public homepage (keep the URL private).

---

## SEO (Google + AI assistants)

Configured in this folder only (`site.config.json`, `inject-seo.mjs`).

| Asset | Purpose |
|--------|---------|
| `site.config.json` | Canonical site URL (`https://hustronix.online` by default), titles, descriptions |
| `robots.txt` | Crawlers + **Sitemap** line; blocks leads viewer |
| `sitemap.xml` | `/`, `/contact`, `/privacy`, `/terms`, `/cookies` |
| `llms.txt` | Summary for ChatGPT, Claude, Perplexity, and other LLM crawlers ([llms.txt spec](https://llmstxt.org/)) |
| Per-page meta | Title, description, canonical, Open Graph, Twitter |
| JSON-LD | Organization, WebSite, WebPage, SoftwareApplication, FAQPage (home) |

**Different Netlify URL?** Before deploy:

```bash
set SITE_URL=https://your-site.netlify.app
node inject-seo.mjs
```

Or edit `site.config.json` → `url`.

**Google Search Console:** add property for your live domain → submit `https://YOUR-DOMAIN/sitemap.xml`.

**Verify:** view page source for `<link rel="canonical">` and `<script type="application/ld+json">`.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| Form says it could not save | Redeploy after build (`npm install` in site + `netlify/functions`); check **Functions** logs |
| Leads **HTTP 502** | Netlify **Base directory** must be `plainlandingpage` (not repo root). Redeploy so `npm install` runs (`netlify.toml` build command). Check **Functions → list-early-access** logs. Only these functions: `submit-early-access`, `list-early-access` |
| Leads 404 | Site must be on Netlify (functions do not run on static hosts) |
| Empty list after submit | Submit on homepage first, wait a few seconds, **Refresh**; check `submit-early-access` logs |

---

## Files you must include in the deploy zip / Git

- `index.html`, `styles.css`, all `*.js` in this folder
- `spandanpatilleads.html`, `leads.js`, `site-pages.css`
- `netlify/functions/` (`submit-early-access`, `list-early-access`, `netlify/functions/lib/leads-store.mjs`)
- `package.json` + `package-lock.json` (installs `@netlify/blobs` for functions)
- `package.json` (for `@netlify/blobs` at build time)
- `netlify.toml`
- `brand/`
- `robots.txt`, `sitemap.xml`, `llms.txt`, `site.config.json`, `lib/seo.mjs`, `inject-seo.mjs`

Do **not** need: `_next/`, `node_modules/` (installed on build).
