/**
 * Netlify demand landing layout: header scroll CTA, no hero/footer duplicate form block.
 * Does not modify apps/web — run after sanitizeDemandLanding in export pipeline.
 */

const HEADER_SCROLL_CTA = `<a href="#early-access" data-scroll-early-access="" class="landing-cta-primary shrink-0 rounded-full px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]">Early access</a>`;

const FOOTER_SOCIAL_SNIPPET = `<nav class="landing-footer-social mt-6 flex items-center gap-2" aria-label="Social media"><a href="https://www.linkedin.com/company/hustronix/" target="_blank" rel="noopener noreferrer" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-hx-muted transition-colors duration-200 hover:border-landing-gold/35 hover:bg-landing-gold/10 hover:text-landing-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-gold/60" aria-label="Hustronix on LinkedIn"><svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a><a href="https://www.instagram.com/hustronix.online" target="_blank" rel="noopener noreferrer" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-hx-muted transition-colors duration-200 hover:border-landing-gold/35 hover:bg-landing-gold/10 hover:text-landing-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-gold/60" aria-label="Hustronix on Instagram"><svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg></a><a href="https://x.com/hustronix31431" target="_blank" rel="noopener noreferrer" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] text-hx-muted transition-colors duration-200 hover:border-landing-gold/35 hover:bg-landing-gold/10 hover:text-landing-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-gold/60" aria-label="Hustronix on X"><svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a></nav>`;

function findTagClose(html, openStart, tagName) {
  const openRe = new RegExp(`<${tagName}\\b`, "gi");
  const close = `</${tagName}>`;
  let depth = 0;
  let pos = openStart;
  while (pos < html.length) {
    openRe.lastIndex = pos;
    const openMatch = openRe.exec(html);
    const closeIdx = html.indexOf(close, pos);
    if (closeIdx === -1) return -1;
    if (openMatch && openMatch.index < closeIdx) {
      depth += 1;
      pos = openMatch.index + openMatch[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return closeIdx + close.length;
    pos = closeIdx + close.length;
  }
  return -1;
}

function replaceHeaderCompactForm(html) {
  const marker = 'data-source="landing-header"';
  const idx = html.indexOf(marker);
  if (idx < 0) return html;
  const formStart = html.lastIndexOf("<form", idx);
  if (formStart < 0) return html;
  const formEnd = findTagClose(html, formStart, "form");
  if (formEnd < 0) return html;
  return html.slice(0, formStart) + HEADER_SCROLL_CTA + html.slice(formEnd);
}

/** Remove full early-access block inserted above footer (legacy layout). */
function removeEarlyAccessFooterSection(html) {
  const needle =
    '<section class="landing-zone-neutral border-t border-white/[0.06] bg-[#0A0A0A] scroll-mt-28"';
  const start = html.indexOf(needle);
  if (start < 0) return html;
  const end = findTagClose(html, start, "section");
  if (end < 0) return html;
  return html.slice(0, start) + html.slice(end);
}

/** Drop hero early-access form; keep “See how it works” in hero. */
function stripHeroEarlyAccessForm(html) {
  const marker = 'data-source="landing-hero"';
  const idx = html.indexOf(marker);
  if (idx < 0) return html;

  const formStart = html.lastIndexOf("<form", idx);
  const formEnd = findTagClose(html, formStart, "form");
  if (formStart < 0 || formEnd < 0) return html;

  const wrapperNeedle = '<div class="mx-auto mt-9 w-full max-w-2xl md:mt-11">';
  let wrapperStart = html.lastIndexOf(wrapperNeedle, formStart);
  if (wrapperStart < 0) wrapperStart = formStart;
  let removeEnd = formEnd;
  if (html.slice(removeEnd, removeEnd + 6) === "</div>") removeEnd += 6;

  return html.slice(0, wrapperStart) + html.slice(removeEnd);
}

const FRAME_WRAPPER_NEEDLES = [
  '<div class="mx-auto max-w-6xl px-6 md:px-8 relative pb-6 pt-5 md:pb-10 md:pt-6">',
  '<div class="mx-auto max-w-6xl px-6 md:px-8 relative pb-12 pt-4 md:pb-20 md:pt-8">',
];

function findFrameWrapperStart(html) {
  for (const needle of FRAME_WRAPPER_NEEDLES) {
    const idx = html.indexOf(needle);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Hero headline copy, then product preview (below the text block). */
function reorderHeroProductFrameAfterCopy(html) {
  const copyNeedle =
    '<div class="mx-auto max-w-6xl px-6 md:px-8 flex w-full flex-col items-center pb-7 pt-9 text-center md:pb-11 md:pt-12">';
  const copyStart = html.indexOf(copyNeedle);
  const frameStart = findFrameWrapperStart(html);
  if (copyStart < 0 || frameStart < 0 || copyStart < frameStart) return html;

  const copyEnd = findTagClose(html, copyStart, "div");
  const frameEnd = findTagClose(html, frameStart, "div");
  if (copyEnd < 0 || frameEnd < 0) return html;

  const copyBlock = html.slice(copyStart, copyEnd);
  let frameBlock = html.slice(frameStart, frameEnd);
  frameBlock = frameBlock
    .replace(
      "relative pb-6 pt-5 md:pb-10 md:pt-6",
      "relative pb-12 pt-4 md:pb-20 md:pt-8",
    )
    .replace("mt-2 w-full max-w-5xl md:mt-4", "mt-10 w-full max-w-5xl md:mt-14")
    .replace(/\smd:mt-14\s+md:mt-14/g, " md:mt-14");

  return (
    html.slice(0, frameStart) + copyBlock + frameBlock + html.slice(copyEnd)
  );
}

function injectNetlifyScripts(html) {
  let out = html;
  for (const src of ["hero-product-carousel.js", "landing-nav.js"]) {
    if (!out.includes(src)) {
      out = out.replace(
        "</body>",
        `<script src="${src}" defer></script>\n</body>`,
      );
    }
  }
  return out;
}

/** Header scroll target: final on-page early-access form. */
function ensureFinalCtaEarlyAccessId(html) {
  const marker = 'data-source="landing-final-cta"';
  const idx = html.indexOf(marker);
  if (idx < 0) return html;
  const formStart = html.lastIndexOf("<form", idx);
  if (formStart < 0) return html;
  const head = html.slice(formStart, formStart + 400);
  if (/\bid="early-access"/.test(head)) return html;
  return `${html.slice(0, formStart + 5)} id="early-access"${html.slice(formStart + 5)}`;
}

/** Netlify Forms + JS backup: native POST if fetch fails; detected at deploy time. */
function ensureNetlifyFormAttrs(html) {
  const marker = "data-early-access";
  let out = html;
  let searchFrom = 0;
  while (true) {
    const idx = out.indexOf(marker, searchFrom);
    if (idx < 0) break;
    const formStart = out.lastIndexOf("<form", idx);
    if (formStart < 0) break;
    const formEnd = findTagClose(out, formStart, "form");
    if (formEnd < 0) break;

    let formHtml = out.slice(formStart, formEnd);
    if (!/\bname="early-access"/.test(formHtml)) {
      formHtml = formHtml.replace("<form", '<form name="early-access"');
    }
    if (!/\bmethod="POST"/i.test(formHtml)) {
      formHtml = formHtml.replace("<form", '<form method="POST"');
    }
    if (!/\bdata-netlify="true"/.test(formHtml)) {
      formHtml = formHtml.replace("<form", '<form data-netlify="true"');
    }
    if (!/\bnetlify-honeypot=/.test(formHtml)) {
      formHtml = formHtml.replace(
        "<form",
        '<form netlify-honeypot="bot-field"',
      );
    }
    if (!/name="form-name"/.test(formHtml)) {
      formHtml = formHtml.replace(
        /<form([^>]*)>/i,
        '<form$1><input type="hidden" name="form-name" value="early-access"/>',
      );
    }
    if (!/name="bot-field"/.test(formHtml)) {
      formHtml = formHtml.replace(
        /<form([^>]*)>/i,
        '<form$1><p class="hidden" aria-hidden="true"><label>Don\u2019t fill this out: <input name="bot-field"/></label></p>',
      );
    }

    out = out.slice(0, formStart) + formHtml + out.slice(formEnd);
    searchFrom = formStart + formHtml.length;
  }
  return out;
}

function injectFooterSocialLinks(html) {
  if (html.includes("landing-footer-social")) return html;
  const needles = [
    "built for operators.</p></div><div><h2 class=\"mb-4",
    "built for operators.</p></div><div><h2 class='mb-4",
  ];
  for (const needle of needles) {
    if (html.includes(needle)) {
      return html.replace(
        needle,
        `built for operators.</p>${FOOTER_SOCIAL_SNIPPET}</div><div><h2 class="mb-4`,
      );
    }
  }
  return html;
}

export function applyNetlifyLandingLayout(html) {
  let out = html;
  if (out.includes('data-source="landing-header"')) {
    out = replaceHeaderCompactForm(out);
  }
  out = removeEarlyAccessFooterSection(out);
  out = stripHeroEarlyAccessForm(out);
  out = reorderHeroProductFrameAfterCopy(out);
  out = ensureFinalCtaEarlyAccessId(out);
  out = ensureNetlifyFormAttrs(out);
  out = injectFooterSocialLinks(out);
  out = injectNetlifyScripts(out);
  return out;
}
