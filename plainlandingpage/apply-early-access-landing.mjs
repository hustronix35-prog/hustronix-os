/**
 * Demand-validation landing: early-access form in #final-cta, hero scroll CTA.
 * Run after copying/exporting index.html: node apply-early-access-landing.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(__dirname, "index.html");

const HERO_SCROLL_CTA = `<div class="hero-reveal-item"><div class="mt-9 flex flex-wrap items-center justify-center gap-4 md:mt-11"><a class="landing-cta-primary landing-cta-shine inline-flex min-h-[48px] items-center justify-center rounded-full px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.12em]" href="#early-access" data-scroll-early-access="">Early access</a></div></div>`;

const FINAL_EARLY_ACCESS = `<div id="early-access" class="landing-early-access mx-auto mt-12 w-full max-w-lg scroll-mt-28 md:mt-14"><p class="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-landing-gold">Request early access</p><form data-early-access="" data-source="landing-final-cta" name="early-access" method="POST" data-netlify="true" netlify-honeypot="bot-field" class="landing-early-access-form grid gap-3 text-left sm:grid-cols-2"><input type="hidden" name="form-name" value="early-access"/><p class="hidden" aria-hidden="true"><label>Don\u2019t fill this out: <input name="bot-field"/></label></p><label class="block sm:col-span-2"><span class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-hx-muted">Name</span><input name="name" type="text" required maxlength="100" autocomplete="name" class="landing-ea-input"/></label><label class="block sm:col-span-2"><span class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-hx-muted">Work email</span><input name="email" type="email" required maxlength="254" autocomplete="email" class="landing-ea-input"/></label><label class="block"><span class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-hx-muted">Company <span class="font-normal normal-case text-hx-muted/70">(optional)</span></span><input name="company" type="text" maxlength="120" autocomplete="organization" class="landing-ea-input"/></label><label class="block"><span class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-hx-muted">Role <span class="font-normal normal-case text-hx-muted/70">(optional)</span></span><input name="role" type="text" maxlength="80" autocomplete="organization-title" class="landing-ea-input"/></label><button type="submit" class="landing-cta-primary landing-cta-shine sm:col-span-2 mt-1 inline-flex min-h-[52px] w-full items-center justify-center rounded-full px-10 py-4 text-sm font-semibold uppercase tracking-[0.12em]">Join waitlist</button></form></div>`;

function main() {
  let html = fs.readFileSync(INDEX, "utf8");

  if (!html.includes('href="styles.css"')) {
    throw new Error("Unexpected index.html — missing styles.css");
  }
  if (!html.includes("landing-extra.css")) {
    html = html.replace(
      '<link rel="stylesheet" href="styles.css"/>',
      '<link rel="stylesheet" href="styles.css"/>\n<link rel="stylesheet" href="landing-extra.css"/>',
    );
  }

  html = html.replace(
    /<title>[^<]*<\/title>/,
    "<title>Hustronix Decision Intelligence System</title>",
  );

  html = html.replace(
    /<a class="text-hx-muted transition-colors hover:text-hx-text" href="\/login">Sign in<\/a>/g,
    "",
  );

  html = html.replace(
    /<section class="landing-zone-hero relative overflow-hidden border-t-0 bg-gradient-to-b from-landing-void via-\[#030303\] to-black py-28 md:py-40 scroll-mt-\[4\.25rem\] md:scroll-mt-20" id="early-access">/,
    '<section class="landing-zone-hero relative overflow-hidden border-t-0 bg-gradient-to-b from-landing-void via-[#030303] to-black py-28 md:py-40 scroll-mt-[4.25rem] md:scroll-mt-20" id="final-cta">',
  );

  const heroFormRe =
    /<div class="hero-reveal-item"><div id="early-access" class="landing-early-access[\s\S]*?<\/form><\/div><\/div>/;
  if (heroFormRe.test(html)) {
    html = html.replace(heroFormRe, HERO_SCROLL_CTA);
  } else {
    const heroCtaRe =
      /<div class="hero-reveal-item"><div class="mt-9 flex flex-wrap items-center justify-center gap-4 md:mt-11"><a class="landing-cta-primary[^"]*" href="[^"]*"[^>]*>[^<]*<\/a><\/div><\/div>/;
    if (heroCtaRe.test(html) && !html.includes("landing-early-access-form")) {
      html = html.replace(heroCtaRe, HERO_SCROLL_CTA);
    }
  }

  if (!html.includes('id="early-access"')) {
    const scrollCtaRe =
      /<div class="mt-12 flex flex-wrap items-center justify-center gap-4 md:mt-14"><a class="landing-cta-primary[^>]*href="#early-access"[^>]*>Early access<\/a><\/div>/;
    const finalFormRe =
      /<div id="early-access" class="landing-early-access[\s\S]*?<\/form><\/div>/;
    if (finalFormRe.test(html)) {
      html = html.replace(finalFormRe, FINAL_EARLY_ACCESS);
    } else if (scrollCtaRe.test(html)) {
      html = html.replace(scrollCtaRe, FINAL_EARLY_ACCESS);
    } else {
      const needle =
        '<p class="mx-auto mt-8 max-w-lg text-lg text-hx-muted/70">Build one that ensures clarity and execution.</p>';
      if (html.includes(needle)) {
        html = html.replace(needle, needle + FINAL_EARLY_ACCESS);
      } else {
        throw new Error("Final CTA section anchor not found");
      }
    }
  }

  if (html.includes("/signup") || html.includes("Get Started") || html.includes("Start Free")) {
    console.warn("Warning: product CTAs may remain — check index.html");
  }
  if (!html.includes("data-early-access")) {
    throw new Error("Early access form missing after patch");
  }

  fs.writeFileSync(INDEX, html);
  console.log("Applied early-access demand landing to index.html");
}

main();
