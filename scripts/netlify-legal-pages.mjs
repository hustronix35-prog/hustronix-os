import fs from "node:fs";
import path from "node:path";

const LAST_UPDATED = "May 4, 2026";

function shell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-demand-landing="1">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title} — Hustronix</title>
  <link rel="stylesheet" href="styles.css"/>
  <link rel="stylesheet" href="site-pages.css"/>
  <link rel="icon" href="brand/hustronix-mark.png" type="image/png"/>
  <script>document.documentElement.setAttribute("data-theme","dark");</script>
</head>
<body class="min-h-dvh bg-hx-bg font-sans text-hx-text antialiased">
  <header class="site-page-header">
    <div class="site-page-header-inner">
      <a href="index.html" class="site-wordmark">HUSTRONI<span>X</span></a>
      <nav class="site-page-nav" aria-label="Site">
        <a href="index.html#early-access">Early access</a>
        <a href="contact.html">Contact</a>
      </nav>
    </div>
  </header>
  <main class="site-page-main legal-prose">
    <p class="legal-updated">Last updated ${LAST_UPDATED}</p>
    <h1>${title}</h1>
    ${bodyHtml}
  </main>
  <footer class="site-page-footer">
    <p>© 2026 Hustronix. All rights reserved.</p>
    <nav aria-label="Legal">
      <a href="privacy.html">Privacy</a>
      <a href="terms.html">Terms</a>
      <a href="cookies.html">Cookies</a>
      <a href="contact.html">Contact</a>
    </nav>
  </footer>
</body>
</html>`;
}

const PRIVACY = `
<p>This Privacy Policy describes how Hustronix ("we," "us," or "our") handles personal information when you visit our marketing site or request early access to the Decision Operating System.</p>
<h2>Information we collect</h2>
<ul>
<li><strong>Waitlist and contact data</strong> — name, email, company, role, and messages you submit through our forms.</li>
<li><strong>Technical data</strong> — IP address, browser type, and timestamps needed to operate and secure the site.</li>
</ul>
<h2>How we use information</h2>
<ul>
<li>Respond to early-access and contact requests;</li>
<li>Measure interest in the product and improve our messaging;</li>
<li>Prevent abuse and comply with law.</li>
</ul>
<h2>Cookies</h2>
<p>See our <a href="cookies.html">Cookie Policy</a> for details on cookies and similar technologies.</p>
<h2>Retention</h2>
<p>We retain submissions for as long as needed to evaluate demand and communicate with you, unless you ask us to delete them sooner where applicable law allows.</p>
<h2>Your rights</h2>
<p>Depending on your location, you may have rights to access, correct, or delete your personal information. Contact us using the details below.</p>
<h2>Contact</h2>
<p>For privacy questions, email <a href="mailto:privacy@hustronix.online">privacy@hustronix.online</a> or use our <a href="contact.html">contact form</a>.</p>
`;

const TERMS = `
<p>These Terms of Service ("Terms") govern your use of this marketing website and any early-access program we offer for Hustronix. By submitting a form or using this site, you agree to these Terms.</p>
<h2>Early access</h2>
<p>Early access is invitation-only and may be changed or withdrawn at any time. We do not guarantee availability, features, or pricing.</p>
<h2>Acceptable use</h2>
<p>You agree not to misuse this site, including attempting unauthorized access, scraping at abusive rates, or submitting false or harmful information.</p>
<h2>Disclaimers</h2>
<p>THIS SITE AND ANY PREVIEW MATERIALS ARE PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. PRODUCT CAPABILITIES DESCRIBED ON THIS SITE MAY CHANGE BEFORE GENERAL RELEASE.</p>
<h2>Limitation of liability</h2>
<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, HUSTRONIX WILL NOT BE LIABLE FOR INDIRECT OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THIS MARKETING SITE.</p>
<h2>Changes</h2>
<p>We may update these Terms by posting a revised version on this page.</p>
<h2>Contact</h2>
<p>Questions about these Terms: <a href="mailto:legal@hustronix.online">legal@hustronix.online</a>.</p>
`;

const COOKIES = `
<p>This Cookie Policy explains how we use cookies and similar technologies on this marketing site. Read it together with our <a href="privacy.html">Privacy Policy</a>.</p>
<h2>What are cookies?</h2>
<p>Cookies are small text files stored on your device when you visit a website.</p>
<h2>How we use cookies</h2>
<ul>
<li><strong>Strictly necessary</strong> — basic operation and security.</li>
<li><strong>Preferences</strong> — theme or display settings where applicable.</li>
<li><strong>Analytics</strong> — aggregate usage to understand interest in the product (if enabled).</li>
</ul>
<h2>Your choices</h2>
<p>Most browsers let you refuse or delete cookies. Blocking necessary cookies may limit form submissions.</p>
<h2>Contact</h2>
<p>Questions: <a href="mailto:privacy@hustronix.online">privacy@hustronix.online</a>.</p>
`;

const CONTACT_PAGE = `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-demand-landing="1">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Contact — Hustronix</title>
  <link rel="stylesheet" href="styles.css"/>
  <link rel="stylesheet" href="site-pages.css"/>
  <link rel="icon" href="brand/hustronix-mark.png" type="image/png"/>
  <script>document.documentElement.setAttribute("data-theme","dark");</script>
</head>
<body class="min-h-dvh bg-hx-bg font-sans text-hx-text antialiased">
  <header class="site-page-header">
    <div class="site-page-header-inner">
      <a href="index.html" class="site-wordmark">HUSTRONI<span>X</span></a>
      <nav class="site-page-nav" aria-label="Site">
        <a href="index.html#early-access">Early access</a>
        <a href="contact.html" aria-current="page">Contact</a>
      </nav>
    </div>
  </header>
  <main class="site-page-main">
    <h1>Contact us</h1>
    <p class="text-hx-muted text-sm max-w-xl">Questions about early access, partnerships, or the Decision Operating System — send a message and we will respond by email.</p>
    <form data-contact-form data-source="netlify-contact" class="contact-form-card mt-8">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="contact-field">
          <span>Name</span>
          <input name="name" type="text" required maxlength="100" autocomplete="name"/>
        </label>
        <label class="contact-field">
          <span>Email</span>
          <input name="email" type="email" required maxlength="254" autocomplete="email"/>
        </label>
        <label class="contact-field sm:col-span-2">
          <span>Company <span class="optional">(optional)</span></span>
          <input name="company" type="text" maxlength="120" autocomplete="organization"/>
        </label>
        <label class="contact-field sm:col-span-2">
          <span>Subject</span>
          <input name="subject" type="text" required maxlength="140"/>
        </label>
        <label class="contact-field sm:col-span-2">
          <span>Message</span>
          <textarea name="message" required maxlength="4000" rows="6"></textarea>
        </label>
      </div>
      <button type="submit" class="contact-submit">Send message</button>
    </form>
  </main>
  <footer class="site-page-footer">
    <p>© 2026 Hustronix. All rights reserved.</p>
    <nav aria-label="Legal">
      <a href="privacy.html">Privacy</a>
      <a href="terms.html">Terms</a>
      <a href="cookies.html">Cookies</a>
      <a href="contact.html">Contact</a>
    </nav>
  </footer>
  <script src="contact.js" defer></script>
</body>
</html>`;

export function writeLegalPages(outDir) {
  fs.writeFileSync(path.join(outDir, "privacy.html"), shell("Privacy Policy", PRIVACY), "utf8");
  fs.writeFileSync(path.join(outDir, "terms.html"), shell("Terms of Service", TERMS), "utf8");
  fs.writeFileSync(path.join(outDir, "cookies.html"), shell("Cookie Policy", COOKIES), "utf8");
  fs.writeFileSync(path.join(outDir, "contact.html"), CONTACT_PAGE, "utf8");
}
