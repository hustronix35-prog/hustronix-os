import { HOME_META_DESCRIPTION } from "@/lib/seo-constants";
import { getSiteUrl } from "@/lib/site";

/**
 * Google + assistant-friendly JSON-LD. OG/Twitter use `/brand/hustronix-logo.png` as the share image
 * (no dedicated 1200×630 asset yet); add `public/og.png` later and point openGraph.images to it.
 */
export function SeoJsonLd() {
  const siteUrl = getSiteUrl();
  const logoUrl = `${siteUrl}/brand/hustronix-logo.png`;

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "Hustronix",
        url: siteUrl,
        logo: { "@type": "ImageObject", url: logoUrl },
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: "hello@hustronix.online",
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "Hustronix",
        url: siteUrl,
        description: HOME_META_DESCRIPTION,
        publisher: { "@id": `${siteUrl}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}/#software`,
        name: "Hustronix",
        description: HOME_META_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Any",
        url: siteUrl,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
