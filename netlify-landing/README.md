# Hustronix demand-validation landing (static)

Marketing-only copy of the Next.js landing page for **Netlify** — early access + contact forms, no links into the main product app (no sign-in, pricing, or dashboard routes).

The live product at `http://127.0.0.1:3005/` is unchanged; only this folder is sanitized for demand testing.

## Regenerate from the app

```bash
npm run build:web
npm run start:unified   # http://127.0.0.1:3005
node scripts/export-netlify-landing.mjs
```

Optional export URL: `LANDING_EXPORT_URL=https://your-preview.example node scripts/export-netlify-landing.mjs`

Re-run only the sanitizer (if `index.html` already exists):

```bash
node scripts/sanitize-netlify-demand.mjs
```

## Early access form (no Google Sheet, no database)

Submissions from `#early-access` are stored in **Netlify Blobs** (a small JSON list on your Netlify site) via `POST /.netlify/functions/submit-early-access`.

Optional fallbacks:

1. **Hustronix API** — if `<html data-api-base="https://api…">` is set.
2. **Netlify Forms** — if the function is unavailable (`data-netlify` on the form).

Default Netlify-only deploy:

```html
<html data-form-backend="netlify" lang="en">
```

### Netlify setup

1. **Site → Environment variables** → add **`EARLY_ACCESS_ADMIN_PASSWORD`** (password for `leads.html` only; not in source code).
2. **Deploy** with publish directory `netlify-landing` (functions in `netlify/functions/`).
3. First deploy: run **`npm install`** in that folder (Netlify build command below) so `@netlify/blobs` is available.

Suggested **build command** (Netlify UI or `netlify.toml`):

```bash
npm install
```

**Local testing (recommended):**

```bash
cd netlify-landing
npm install
npm run dev
```

Open `http://127.0.0.1:8888/leads.html` — password from `.env`. Plain `npx serve` **cannot** run the leads API (you will see “Could not load leads” / 404).

## View leads on `leads.html` (password-protected)

Private page on the same site — **do not link it from the public landing**.

1. Set **`EARLY_ACCESS_ADMIN_PASSWORD`** in Netlify (same password you type on the page).
2. Open `https://your-site.netlify.app/leads.html` and unlock.
3. Table shows every submission saved by the form (newest first). **Refresh**, **Export CSV**, or **Lock**.

Entries are not written into the HTML file itself (browsers cannot do that safely). They live in Netlify storage and are loaded into `leads.html` after you enter the password.

## API for forms (optional)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/early-access` | Waitlist via Hustronix API (SQLite) |
| `POST /api/contact` | Contact page messages |

```html
<html data-api-base="https://api.your-domain.com" ...>
```

Env on the API server: `CONTACT_TO`, `SMTP_*`, `EARLY_ACCESS_TO` (optional).

## Deploy to Netlify

1. **Base directory / publish directory:** `netlify-landing`
2. **Build command:** `npm install` (installs `@netlify/blobs` for functions)
3. **Environment:** `EARLY_ACCESS_ADMIN_PASSWORD`

## Pages

| File | Role |
|------|------|
| `index.html` | Landing + early access form |
| `leads.html`, `leads.js` | Password-protected submission viewer |
| `contact.html` | Contact form |
| `privacy.html`, `terms.html`, `cookies.html` | Legal |
| `early-access.js`, `contact.js` | Form handlers |
| `netlify/functions/` | `submit-early-access`, `list-early-access` |

Legacy optional Google Sheets script: `setup/google-apps-script-early-access.gs` (not required).
